const slugify = require('slugify');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const Category = require('../models/Category');
const ApiError = require('../utils/ApiError');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeSearchInput = (search) => {
  if (typeof search !== 'string') return '';
  return search.trim().replace(/\s+/g, ' ');
};

const buildSearchFilter = async (search) => {
  const keyword = normalizeSearchInput(search);
  if (!keyword) return null;

  const keywordRegex = new RegExp(escapeRegExp(keyword), 'i');
  const conditions = [
    { name: keywordRegex },
    { slug: keywordRegex },
    { description: keywordRegex },
    { brand: keywordRegex },
    { targetGender: keywordRegex },
    { status: keywordRegex },
    { images: keywordRegex },
  ];

  if (mongoose.Types.ObjectId.isValid(keyword)) {
    const objectId = new mongoose.Types.ObjectId(keyword);
    conditions.push({ _id: objectId }, { categoryId: objectId });
  }

  const categoryIds = await Category.find({
    $or: [{ name: keywordRegex }, { slug: keywordRegex }],
  }).distinct('_id');

  if (categoryIds.length > 0) {
    conditions.push({ categoryId: { $in: categoryIds } });
  }

  return {
    $or: conditions,
  };
};

const normalizeObjectId = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return value;
  return new mongoose.Types.ObjectId(value);
};

const buildSlug = (value) => slugify(value, { lower: true, strict: true });

const getUniqueSlug = async (baseSlug, excludeProductId = null) => {
  const slug = baseSlug || `product-${Date.now()}`;
  const query = { slug: new RegExp(`^${escapeRegExp(slug)}(-\\d+)?$`) };

  if (excludeProductId) {
    query._id = { $ne: excludeProductId };
  }

  const existingSlugs = await Product.find(query).select('slug').lean();
  const usedSlugs = new Set(existingSlugs.map((product) => product.slug));

  if (!usedSlugs.has(slug)) return slug;

  let suffix = 2;
  while (usedSlugs.has(`${slug}-${suffix}`)) {
    suffix += 1;
  }

  return `${slug}-${suffix}`;
};

/**
 * Danh sách sản phẩm — filter, search, pagination, sort
 */
const getProducts = async (query) => {
  let {
    page = 1,
    limit = 10,
    categoryId,
    targetGender,
    search,
    status,
    sort = 'newest',
  } = query;

  page = parseInt(page);
  limit = parseInt(limit);

  // Base filter: chỉ sản phẩm chưa bị xóa
  const filter = { isDeleted: false };

  // Public mặc định chỉ hiện active
  if (status && status !== 'all') {
    filter.status = status;
  } else if (!status) {
    filter.status = 'active';
  }

  if (categoryId) filter.categoryId = normalizeObjectId(categoryId);
  if (targetGender) filter.targetGender = targetGender;

  // Search exact phrase in public product fields instead of broad $text OR matching.
  const searchFilter = await buildSearchFilter(search);
  if (searchFilter) {
    Object.assign(filter, searchFilter);
  }

  // Sort options
  let sortOption = { createdAt: -1 }; // newest
  if (sort === 'price_asc' || sort === 'price_desc') {
    // Sort theo price cần aggregate vì price ở ProductVariant
    return getProductsSortedByPrice(filter, sort, page, limit);
  }
  if (sort === 'best_selling') {
    return getProductsSortedByBestSelling(filter, page, limit);
  }
  if (sort === 'oldest') sortOption = { createdAt: 1 };

  const [products, total] = await Promise.all([
    Product.find(filter)
      .populate('categoryId', 'name slug')
      .sort(sortOption)
      .skip((page - 1) * limit)
      .limit(limit),
    Product.countDocuments(filter),
  ]);

  return {
    products,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Sort sản phẩm theo số lượng bán (đơn delivered), có fallback theo createdAt.
 */
const getProductsSortedByBestSelling = async (filter, page, limit) => {
  const pipeline = [
    { $match: filter },
    {
      $lookup: {
        from: 'orders',
        let: { pid: '$_id' },
        pipeline: [
          { $match: { orderStatus: 'delivered' } },
          { $unwind: '$items' },
          { $match: { $expr: { $eq: ['$items.productId', '$$pid'] } } },
          {
            $group: {
              _id: null,
              soldCount: { $sum: '$items.quantity' },
            },
          },
        ],
        as: 'sales',
      },
    },
    {
      $addFields: {
        soldCount: {
          $ifNull: [{ $arrayElemAt: ['$sales.soldCount', 0] }, 0],
        },
      },
    },
    { $sort: { soldCount: -1, createdAt: -1 } },
    {
      $facet: {
        data: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        total: [{ $count: 'count' }],
      },
    },
  ];

  const [result] = await Product.aggregate(pipeline);
  const products = result.data;
  const total = result.total[0]?.count || 0;

  return {
    products,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Sort sản phẩm theo giá (giá thấp nhất từ variants)
 */
const getProductsSortedByPrice = async (filter, sort, page, limit) => {
  const sortDir = sort === 'price_asc' ? 1 : -1;

  const pipeline = [
    { $match: filter },
    {
      $lookup: {
        from: 'productvariants',
        localField: '_id',
        foreignField: 'productId',
        as: 'variants',
      },
    },
    {
      $addFields: {
        minPrice: { $min: '$variants.price' },
      },
    },
    { $sort: { minPrice: sortDir } },
    {
      $facet: {
        data: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        total: [{ $count: 'count' }],
      },
    },
  ];

  const [result] = await Product.aggregate(pipeline);
  const products = result.data;
  const total = result.total[0]?.count || 0;

  return {
    products,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Chi tiết sản phẩm + variants
 */
const getProductByIdOrSlug = async (idOrSlug) => {
  const isObjectId = idOrSlug.match(/^[0-9a-fA-F]{24}$/);
  const query = isObjectId ? { _id: idOrSlug } : { slug: idOrSlug };

  const product = await Product.findOne({ ...query, isDeleted: false }).populate(
    'categoryId',
    'name slug'
  );

  if (!product) {
    throw new ApiError(404, 'Sản phẩm không tồn tại');
  }

  const variants = await ProductVariant.find({ productId: product._id });

  return { product, variants };
};

/**
 * Tạo sản phẩm (Admin)
 */
const createProduct = async (data) => {
  const baseSlug = buildSlug(data.slug || data.name);
  data.slug = await getUniqueSlug(baseSlug);

  return Product.create(data);
};

/**
 * Cập nhật sản phẩm (Admin)
 */
const updateProduct = async (id, data) => {
  const product = await Product.findOne({ _id: id, isDeleted: false });
  if (!product) {
    throw new ApiError(404, 'Sản phẩm không tồn tại');
  }

  if (data.name && !data.slug) {
    const baseSlug = buildSlug(data.name);
    data.slug = await getUniqueSlug(baseSlug, product._id);
  } else if (data.slug && data.slug !== product.slug) {
    const baseSlug = buildSlug(data.slug);
    data.slug = await getUniqueSlug(baseSlug, product._id);
  }

  Object.assign(product, data);
  await product.save();

  return product;
};

/**
 * Soft delete sản phẩm (Admin)
 */
const deleteProduct = async (id) => {
  const product = await Product.findOne({ _id: id, isDeleted: false });
  if (!product) {
    throw new ApiError(404, 'Sản phẩm không tồn tại');
  }

  product.isDeleted = true;
  product.deletedAt = new Date();
  product.status = 'inactive';
  await product.save();

  return product;
};

module.exports = {
  getProducts,
  getProductByIdOrSlug,
  createProduct,
  updateProduct,
  deleteProduct,
};
