const chatbotService = require('../services/chatbotService');
const ApiError = require('../utils/ApiError');

const sendMessage = async (req, res, next) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

    if (!message) {
      throw new ApiError(400, 'Vui lòng nhập nội dung cần tư vấn');
    }

    const result = await chatbotService.sendMessage({
      message,
      userId: req.user?.id,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = { sendMessage };
