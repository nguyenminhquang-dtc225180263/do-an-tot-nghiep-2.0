const express = require('express');
const chatbotController = require('../controllers/chatbotController');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();

const optionalAuthenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

  return authenticate(req, res, next);
};

router.post('/message', optionalAuthenticate, chatbotController.sendMessage);

module.exports = router;
