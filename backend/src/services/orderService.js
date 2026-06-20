const mongoose = require('mongoose');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Address = require('../models/Address');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const ApiError = require('../utils/ApiError');
const behaviorLogService = require('./behaviorLogService');

// Luồng trạng thái hợp lệ
const VALID_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipping', 'cancelled'],
  shipping: ['delivered'],
  delivered: [],
  cancelled: [],
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeSearchInput = (search) => {
  if (typeof search !== 'string') return '';
  return search.trim().replace(/\s+/g, ' ');
};

const buildOrderSearchMatch = (search) => {
  const keyword = normalizeSearchInput(search);
  if (!keyword) return null;

  const keywordRegex = new RegExp(escapeRegExp(keyword), 'i');
  const conditions = [
    { orderIdText: keywordRegex },
    { totalAmountText: keywordRegex },
    { paymentMethod: keywordRegex },
    { paymentStatus: keywordRegex },
    { orderStatus: keywordRegex },
    { createdAtText: keywordRegex },
    { createdAtTextVi: keywordRegex },
    { 'shippingAddress.fullName': keywordRegex },
    { 'shippingAddress.phone': keywordRegex },
    { 'shippingAddress.street': keywordRegex },
    { 'shippingAddress.ward': keywordRegex },
    { 'shippingAddress.district': keywordRegex },
    { 'shippingAddress.cityProvince': keywordRegex },
    { 'shippingAddress.note': keywordRegex },
    { 'items.productName': keywordRegex },
    { 'items.sku': keywordRegex },
    { 'items.size': keywordRegex },
    { 'items.color': keywordRegex },
    { 'user.fullName': keywordRegex },
    { 'user.email': keywordRegex },
    { 'user.phone': keywordRegex },
  ];

  if (mongoose.Types.ObjectId.isValid(keyword)) {
    const objectId = new mongoose.Types.ObjectId(keyword);
    conditions.push(
      { _id: objectId },
      { userId: objectId },
      { 'items.productId': objectId },
      { 'items.variantId': objectId }
    );
  }

  return { $or: conditions };
};

/**
 * Tạo đơn hàng (checkout) — NGHIỆP VỤ CỐT LÕI
 */
const createOrder = async (userId, { addressId, paymentMethod }) => {
  // 1. Lấy cart active
  const cart = await Cart.findOne({ userId, status: 'active' });
  if (!cart || cart.items.length === 0) {
    throw new ApiError(400, 'Giỏ hàng trống');
  }

  // 2. Lookup address → snapshot
  const address = await Address.findOne({ _id: addressId, userId });
  if (!address) {
    throw new ApiError(404, 'Địa chỉ không tồn tại');
  }

  const shippingAddress = {
    fullName: address.fullName,
    phone: address.phone,
    street: address.street,
    ward: address.ward,
    district: address.district,
    cityProvince: address.cityProvince,
    note: address.note,
  };

  // 3. Xử lý từng item: lookup variant, trừ kho, tính giá
  const orderItems = [];
  const deductedVariants = []; // Để rollback nếu cần

  try {
    for (const cartItem of cart.items) {
      // Lookup variant + product
      const variant = await ProductVariant.findById(cartItem.variantId);
      if (!variant) {
        throw new ApiError(400, 'Sản phẩm trong giỏ hàng không còn tồn tại');
      }

      const product = await Product.findById(variant.productId);
      if (!product || product.isDeleted) {
        throw new ApiError(400, `Sản phẩm "${product?.name || 'unknown'}" đã bị xóa`);
      }

      // Trừ kho bằng Atomic $inc
      const updatedVariant = await ProductVariant.findOneAndUpdate(
        { _id: variant._id, stock: { $gte: cartItem.quantity } },
        { $inc: { stock: -cartItem.quantity } },
        { returnDocument: 'after' }
      );

      if (!updatedVariant) {
        throw new ApiError(
          400,
          `Sản phẩm "${product.name}" (${variant.size}/${variant.color}) không đủ tồn kho`
        );
      }

      deductedVariants.push({
        variantId: variant._id,
        quantity: cartItem.quantity,
      });

      // Tính giá server-side
      const unitPrice = variant.price;
      const subtotal = unitPrice * cartItem.quantity;

      orderItems.push({
        productId: product._id,
        variantId: variant._id,
        productName: product.name,
        sku: variant.sku,
        size: variant.size,
        color: variant.color,
        image: variant.image,
        quantity: cartItem.quantity,
        unitPrice,
        subtotal,
      });
    }
  } catch (error) {
    // Rollback: hoàn kho cho các variant đã trừ
    for (const item of deductedVariants) {
      await ProductVariant.findByIdAndUpdate(item.variantId, {
        $inc: { stock: item.quantity },
      });
    }
    throw error;
  }

  // 4. Tính totalAmount server-side
  const totalAmount = orderItems.reduce((sum, item) => sum + item.subtotal, 0);

  // 5. Tạo Order
  const order = await Order.create({
    userId,
    totalAmount,
    paymentMethod,
    shippingAddress,
    items: orderItems,
  });

  // 6. Set cart = checked_out
  cart.status = 'checked_out';
  await cart.save();

  // 7. Log purchase behavior (fire-and-forget)
  for (const item of orderItems) {
    behaviorLogService.logEvent(userId, {
      productId: item.productId,
      variantId: item.variantId,
      eventType: 'purchase',
    }).catch(() => {}); // không block checkout
  }

  return order;
};

/**
 * Danh sách đơn hàng của user (pagination)
 */
const getOrdersByUser = async (userId, { page = 1, limit = 10 }) => {
  page = parseInt(page);
  limit = parseInt(limit);

  const [orders, total] = await Promise.all([
    Order.find({ userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Order.countDocuments({ userId }),
  ]);

  return {
    orders,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

/**
 * Chi tiết đơn hàng (customer — validate ownership)
 */
const getOrderById = async (userId, orderId) => {
  const order = await Order.findOne({ _id: orderId, userId });
  if (!order) {
    throw new ApiError(404, 'Đơn hàng không tồn tại');
  }
  return order;
};

/**
 * Hủy đơn hàng (customer)
 */
const cancelOrder = async (userId, orderId) => {
  const order = await Order.findOne({ _id: orderId, userId });
  if (!order) {
    throw new ApiError(404, 'Đơn hàng không tồn tại');
  }

  if (!['pending', 'confirmed'].includes(order.orderStatus)) {
    throw new ApiError(400, 'Chỉ có thể hủy đơn ở trạng thái chờ xác nhận hoặc đã xác nhận');
  }

  order.orderStatus = 'cancelled';
  order.cancelledAt = new Date();

  // Hoàn kho nếu chưa hoàn
  if (!order.inventoryRestored) {
    for (const item of order.items) {
      await ProductVariant.findByIdAndUpdate(item.variantId, {
        $inc: { stock: item.quantity },
      });
    }
    order.inventoryRestored = true;
  }

  await order.save();
  return order;
};

/**
 * Danh sách tất cả đơn hàng (Admin) — filter, pagination
 */
const getAllOrders = async ({ page = 1, limit = 10, orderStatus, paymentStatus, search } = {}) => {
  page = Math.max(parseInt(page, 10) || 1, 1);
  limit = Math.max(parseInt(limit, 10) || 10, 1);
  const skip = (page - 1) * limit;

  const filter = {};
  if (orderStatus) filter.orderStatus = orderStatus;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  const searchMatch = buildOrderSearchMatch(search);

  const pipeline = [
    { $match: filter },
    {
      $lookup: {
        from: 'users',
        let: { uid: '$userId' },
        pipeline: [
          { $match: { $expr: { $eq: ['$_id', '$$uid'] } } },
          { $project: { fullName: 1, email: 1, phone: 1 } },
        ],
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        orderIdText: { $toString: '$_id' },
        totalAmountText: { $toString: '$totalAmount' },
        createdAtText: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+07:00' },
        },
        createdAtTextVi: {
          $dateToString: { format: '%d/%m/%Y', date: '$createdAt', timezone: '+07:00' },
        },
      },
    },
  ];

  if (searchMatch) {
    pipeline.push({ $match: searchMatch });
  }

  pipeline.push(
    { $sort: { createdAt: -1 } },
    {
      $facet: {
        data: [
          { $skip: skip },
          { $limit: limit },
          { $addFields: { userId: { $ifNull: ['$user', '$userId'] } } },
          {
            $project: {
              user: 0,
              orderIdText: 0,
              totalAmountText: 0,
              createdAtText: 0,
              createdAtTextVi: 0,
            },
          },
        ],
        total: [{ $count: 'count' }],
      },
    }
  );

  const [result] = await Order.aggregate(pipeline);
  const orders = result?.data || [];
  const total = result?.total?.[0]?.count || 0;

  return {
    orders,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

/**
 * Chi tiết đơn hàng (Admin — không validate ownership)
 */
const getOrderByIdAdmin = async (orderId) => {
  const order = await Order.findById(orderId).populate('userId', 'fullName email phone');
  if (!order) {
    throw new ApiError(404, 'Đơn hàng không tồn tại');
  }
  return order;
};

/**
 * Chuyển trạng thái đơn (Admin)
 */
const updateOrderStatus = async (orderId, newStatus) => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new ApiError(404, 'Đơn hàng không tồn tại');
  }

  const allowedNext = VALID_TRANSITIONS[order.orderStatus];
  if (!allowedNext.includes(newStatus)) {
    throw new ApiError(
      400,
      `Không thể chuyển từ "${order.orderStatus}" sang "${newStatus}"`
    );
  }

  order.orderStatus = newStatus;

  // Set timestamps và side effects
  switch (newStatus) {
    case 'confirmed':
      order.confirmedAt = new Date();
      break;

    case 'shipping':
      order.shippedAt = new Date();
      break;

    case 'delivered':
      order.deliveredAt = new Date();
      // COD: auto set paid
      if (order.paymentMethod === 'cod' && order.paymentStatus === 'unpaid') {
        order.paymentStatus = 'paid';
        order.paidAt = new Date();
      }
      break;

    case 'cancelled':
      order.cancelledAt = new Date();
      // Hoàn kho
      if (!order.inventoryRestored) {
        for (const item of order.items) {
          await ProductVariant.findByIdAndUpdate(item.variantId, {
            $inc: { stock: item.quantity },
          });
        }
        order.inventoryRestored = true;
      }
      break;
  }

  await order.save();
  return order;
};

/**
 * Xác nhận thanh toán bank_transfer (Admin)
 */
const updatePaymentStatus = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new ApiError(404, 'Đơn hàng không tồn tại');
  }

  if (order.paymentMethod !== 'bank_transfer') {
    throw new ApiError(400, 'Chỉ áp dụng cho đơn thanh toán chuyển khoản');
  }

  if (order.paymentStatus === 'paid') {
    throw new ApiError(400, 'Đơn hàng đã được thanh toán');
  }

  order.paymentStatus = 'paid';
  order.paidAt = new Date();
  await order.save();

  return order;
};

module.exports = {
  createOrder,
  getOrdersByUser,
  getOrderById,
  cancelOrder,
  getAllOrders,
  getOrderByIdAdmin,
  updateOrderStatus,
  updatePaymentStatus,
};
