const mongoose = require('mongoose');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeSearchInput = (search) => {
  if (typeof search !== 'string') return '';
  return search.trim().replace(/\s+/g, ' ');
};

const buildSearchMatch = (search) => {
  const keyword = normalizeSearchInput(search);
  if (!keyword) return null;

  const keywordRegex = new RegExp(escapeRegExp(keyword), 'i');
  const conditions = [
    { idText: keywordRegex },
    { fullName: keywordRegex },
    { email: keywordRegex },
    { phone: keywordRegex },
    { role: keywordRegex },
    { isActiveText: keywordRegex },
    { createdAtText: keywordRegex },
    { updatedAtText: keywordRegex },
  ];

  if (mongoose.Types.ObjectId.isValid(keyword)) {
    conditions.push({ _id: new mongoose.Types.ObjectId(keyword) });
  }

  return { $or: conditions };
};

/**
 * Danh sách users (Admin) — có pagination
 */
const getUsers = async ({ page = 1, limit = 10, search } = {}) => {
  page = Math.max(parseInt(page, 10) || 1, 1);
  limit = Math.max(parseInt(limit, 10) || 10, 1);
  const skip = (page - 1) * limit;
  const searchMatch = buildSearchMatch(search);

  const pipeline = [
    {
      $addFields: {
        idText: { $toString: '$_id' },
        isActiveText: { $cond: ['$isActive', 'active', 'locked'] },
        createdAtText: {
          $dateToString: { format: '%d/%m/%Y', date: '$createdAt', timezone: '+07:00' },
        },
        updatedAtText: {
          $dateToString: { format: '%d/%m/%Y', date: '$updatedAt', timezone: '+07:00' },
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
          {
            $project: {
              passwordHash: 0,
              idText: 0,
              isActiveText: 0,
              createdAtText: 0,
              updatedAtText: 0,
            },
          },
        ],
        total: [{ $count: 'count' }],
      },
    }
  );

  const [result] = await User.aggregate(pipeline);
  const users = result?.data || [];
  const total = result?.total?.[0]?.count || 0;

  return {
    users,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Chi tiết 1 user
 */
const getUserById = async (id) => {
  const user = await User.findById(id).select('-passwordHash');
  if (!user) {
    throw new ApiError(404, 'User không tồn tại');
  }
  return user;
};

/**
 * Bật/tắt trạng thái user
 */
const toggleActive = async (id) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(404, 'User không tồn tại');
  }

  user.isActive = !user.isActive;
  await user.save();

  return { _id: user._id, isActive: user.isActive };
};

module.exports = { getUsers, getUserById, toggleActive };
