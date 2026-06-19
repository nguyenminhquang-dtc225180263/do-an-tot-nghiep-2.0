const mongoose = require('mongoose');
const OpenAIImport = require('openai');
const productService = require('./productService');
const recommendationService = require('./recommendationService');
const ProductVariant = require('../models/ProductVariant');

const OpenAI = OpenAIImport.default || OpenAIImport;

const SYSTEM_PROMPT =
  'Bạn là chatbot tư vấn sản phẩm cho website thời trang. Chỉ tư vấn dựa trên danh sách sản phẩm được cung cấp. Không bịa sản phẩm, giá, size, màu, tồn kho nếu không có dữ liệu. Trả lời bằng tiếng Việt, thân thiện, ngắn gọn. Nếu có sản phẩm phù hợp, hãy giải thích vì sao phù hợp. Nếu chưa đủ thông tin, hãy hỏi lại khách hàng 1 câu hỏi ngắn.';

const DEFAULT_MODEL = 'gpt-5.5';
const MAX_PRODUCTS_FOR_AI = 8;

let openaiClient = null;
let cachedApiKey = null;

const getOpenAIClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  if (!openaiClient || cachedApiKey !== apiKey) {
    openaiClient = new OpenAI({ apiKey });
    cachedApiKey = apiKey;
  }

  return openaiClient;
};

const toPlainProduct = (product) => {
  if (!product) return null;
  if (typeof product.toObject === 'function') return product.toObject();
  return product;
};

const getProductId = (product) => {
  const plain = toPlainProduct(product);
  const value = plain?._id || plain?.id || plain?.productId;
  return value ? value.toString() : null;
};

const truncate = (value, maxLength = 220) => {
  if (!value) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
};

const getCategoryName = (product) => {
  const category = product.category || product.categoryId;
  if (!category) return null;
  if (typeof category === 'string') return category;
  return category.name || null;
};

const getVariantInfoMap = async (productIds) => {
  const objectIds = productIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (objectIds.length === 0) return {};

  const rows = await ProductVariant.aggregate([
    { $match: { productId: { $in: objectIds } } },
    { $sort: { price: 1, createdAt: 1 } },
    {
      $group: {
        _id: '$productId',
        minPrice: { $first: '$price' },
        image: { $first: '$image' },
      },
    },
  ]);

  return rows.reduce((map, row) => {
    map[row._id.toString()] = {
      minPrice: row.minPrice,
      image: row.image || null,
    };
    return map;
  }, {});
};

const formatProduct = (product, variantInfoMap) => {
  const plain = toPlainProduct(product);
  const id = getProductId(plain);
  const variantInfo = variantInfoMap[id] || {};
  const images = Array.isArray(plain.images) ? plain.images : [];

  return {
    id,
    name: plain.name || '',
    slug: plain.slug || '',
    brand: plain.brand || null,
    targetGender: plain.targetGender || null,
    category: getCategoryName(plain),
    description: truncate(plain.description),
    minPrice: plain.minPrice ?? variantInfo.minPrice ?? null,
    image: images[0] || plain.image || variantInfo.image || null,
  };
};

const mergeProducts = (sources) => {
  const merged = [];
  const seen = new Set();

  sources.flat().forEach((product) => {
    const id = getProductId(product);
    if (!id || seen.has(id)) return;

    seen.add(id);
    merged.push(product);
  });

  return merged.slice(0, MAX_PRODUCTS_FOR_AI);
};

const getRecommendationProducts = async (userId) => {
  if (!userId) return [];

  try {
    return await recommendationService.getRecommendations(userId, 6);
  } catch (error) {
    console.error('[chatbot] Cannot load recommendations:', error.message);
    return [];
  }
};

const getSearchProducts = async (message) => {
  try {
    const result = await productService.getProducts({
      search: message,
      limit: 6,
      page: 1,
      sort: 'newest',
    });
    return result.products || [];
  } catch (error) {
    console.error('[chatbot] Cannot search products:', error.message);
    return [];
  }
};

const collectProducts = async ({ message, userId }) => {
  const [recommendationProducts, searchProducts] = await Promise.all([
    getRecommendationProducts(userId),
    getSearchProducts(message),
  ]);

  const mergedProducts = mergeProducts([recommendationProducts, searchProducts]);
  const productIds = mergedProducts.map(getProductId).filter(Boolean);
  const variantInfoMap = await getVariantInfoMap(productIds);

  return mergedProducts.map((product) => formatProduct(product, variantInfoMap));
};

const buildUserPrompt = (message, products) => {
  const compactProducts = products.map((product) => ({
    id: product.id,
    name: product.name,
    brand: product.brand,
    targetGender: product.targetGender,
    category: product.category,
    description: product.description,
    minPrice: product.minPrice,
  }));

  return [
    `Câu hỏi khách hàng: ${message}`,
    'Danh sách sản phẩm backend cung cấp (JSON, chỉ dùng các dữ liệu này để tư vấn):',
    JSON.stringify(compactProducts, null, 2),
  ].join('\n\n');
};

const extractOutputText = (response) => {
  if (typeof response?.output_text === 'string') {
    return response.output_text.trim();
  }

  const texts = [];
  response?.output?.forEach((item) => {
    item?.content?.forEach((content) => {
      if (typeof content?.text === 'string') texts.push(content.text);
    });
  });

  return texts.join('\n').trim();
};

const buildFallbackReply = (products) => {
  if (products.length > 0) {
    const names = products
      .slice(0, 3)
      .map((product) => product.name)
      .filter(Boolean)
      .join(', ');

    return `Mình đang chưa kết nối được AI, nhưng có vài sản phẩm phù hợp để bạn tham khảo: ${names}. Bạn xem các thẻ sản phẩm bên dưới nhé.`;
  }

  return 'Mình đang chưa kết nối được AI. Bạn cho mình biết thêm loại sản phẩm, phong cách hoặc khoảng giá mong muốn nhé.';
};

const generateReply = async ({ message, products }) => {
  const client = getOpenAIClient();
  if (!client) return buildFallbackReply(products);

  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
      instructions: SYSTEM_PROMPT,
      input: buildUserPrompt(message, products),
      max_output_tokens: 500,
    });

    return extractOutputText(response) || buildFallbackReply(products);
  } catch (error) {
    console.error('[chatbot] OpenAI error:', error.message);
    return buildFallbackReply(products);
  }
};

const sendMessage = async ({ message, userId }) => {
  const products = await collectProducts({ message, userId });
  const reply = await generateReply({ message, products });

  return { reply, products };
};

module.exports = { sendMessage };
