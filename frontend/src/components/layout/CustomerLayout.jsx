import { Outlet } from 'react-router-dom';
import Header from './Header';
import Footer from './Footer';
import ChatWidget from '../chatbot/ChatWidget';

export default function CustomerLayout() {
  return (
    <>
      <Header />
      <main style={{ minHeight: 'calc(100vh - var(--header-height) - 200px)' }}>
        <Outlet />
      </main>
      <Footer />
      <ChatWidget />
    </>
  );
}
