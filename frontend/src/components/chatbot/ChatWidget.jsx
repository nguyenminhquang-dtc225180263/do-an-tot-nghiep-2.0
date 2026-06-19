import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, MessageCircle, Send, X } from 'lucide-react';
import { chatbotService } from '../../services/chatbotService';
import './ChatWidget.css';

const formatPrice = (price) => (
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(price)
);

const createId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'bot',
      text: 'Chào bạn, mình có thể tư vấn sản phẩm thời trang phù hợp từ cửa hàng.',
      products: [],
    },
  ]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || loading) return;

    setInput('');
    setLoading(true);

    const userMessage = {
      id: createId(),
      role: 'user',
      text: message,
      products: [],
    };

    setMessages((current) => [...current, userMessage]);

    try {
      const result = await chatbotService.sendMessage(message);
      setMessages((current) => [
        ...current,
        {
          id: createId(),
          role: 'bot',
          text: result.reply,
          products: result.products || [],
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: createId(),
          role: 'bot',
          text: error.message || 'Mình chưa gửi được tin nhắn. Bạn thử lại sau nhé.',
          products: [],
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`chat-widget ${open ? 'is-open' : ''}`}>
      {open && (
        <section className="chat-panel" aria-label="Chat tư vấn sản phẩm">
          <div className="chat-panel-header">
            <div>
              <h2>Tư vấn thời trang</h2>
              <span>AI gợi ý sản phẩm</span>
            </div>
            <button
              type="button"
              className="chat-icon-button"
              onClick={() => setOpen(false)}
              aria-label="Đóng chat"
              title="Đóng chat"
            >
              <X size={18} />
            </button>
          </div>

          <div className="chat-messages">
            {messages.map((message) => (
              <div key={message.id} className={`chat-message ${message.role}`}>
                <div className="chat-bubble">{message.text}</div>

                {message.products.length > 0 && (
                  <div className="chat-products">
                    {message.products.map((product) => (
                      <Link
                        key={product.id}
                        to={`/products/${product.slug}`}
                        className="chat-product-card"
                        onClick={() => setOpen(false)}
                      >
                        <img
                          src={product.image || 'https://placehold.co/96x120/f8fafc/64748b?text=No+Image'}
                          alt={product.name}
                          loading="lazy"
                        />
                        <div>
                          <strong>{product.name}</strong>
                          {product.minPrice != null && <span>{formatPrice(product.minPrice)}</span>}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="chat-message bot">
                <div className="chat-bubble chat-loading">
                  <Loader2 size={16} />
                  Đang tư vấn...
                </div>
              </div>
            )}
          </div>

          <form className="chat-input-row" onSubmit={handleSubmit}>
            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Bạn đang tìm gì?"
              disabled={loading}
            />
            <button
              type="submit"
              className="chat-send-button"
              disabled={loading || !input.trim()}
              aria-label="Gửi tin nhắn"
              title="Gửi tin nhắn"
            >
              <Send size={18} />
            </button>
          </form>
        </section>
      )}

      {!open && (
        <button
          type="button"
          className="chat-toggle-button"
          onClick={() => setOpen(true)}
          aria-label="Mở chat tư vấn"
          title="Mở chat tư vấn"
        >
          <MessageCircle size={24} />
        </button>
      )}
    </div>
  );
}
