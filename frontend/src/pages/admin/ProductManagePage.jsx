import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { productService } from '../../services/productService';
import { adminService } from '../../services/adminService';
import { useToast } from '../../components/ui/Toast';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Pagination from '../../components/ui/Pagination';
import Spinner from '../../components/ui/Spinner';
import './AdminTable.css';

export default function ProductManagePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState({});
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const params = { page, limit: 15, status: 'all' };
    if (search.trim()) params.search = search.trim();
    productService.getProducts(params)
      .then((data) => { setProducts(data.products || []); setPagination(data.pagination || {}); })
      .finally(() => setLoading(false));
  }, [page, search]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const handleDelete = async (id) => {
    if (!confirm('Xóa sản phẩm này?')) return;
    try { await adminService.deleteProduct(id); toast('Đã xóa sản phẩm'); load(); }
    catch (err) { toast(err.message, 'error'); }
  };

  return (
    <div className="admin-table-page">
      <div className="admin-table-header">
        <h1 className="page-title" style={{ marginBottom: 0 }}>Quản lý sản phẩm</h1>
        <Button onClick={() => navigate('/admin/products/new')}>+ Thêm sản phẩm</Button>
      </div>
      <div className="admin-filters">
        <input
          className="admin-search-input"
          type="search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Tìm kiếm sản phẩm..."
        />
      </div>
      {loading ? <div className="page-loading"><Spinner /></div> : (
        <>
          <table className="admin-table">
            <thead><tr><th>Ảnh</th><th>Tên</th><th>Danh mục</th><th>Trạng thái</th><th>Variants</th><th>Thao tác</th></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p._id}>
                  <td><img src={p.images?.[0] || 'https://placehold.co/40x50/f8fafc/64748b?text=N'} alt="" style={{ width: 40, height: 50, objectFit: 'cover', borderRadius: 4 }} /></td>
                  <td>{p.name}</td>
                  <td>{p.categoryId?.name || '—'}</td>
                  <td><Badge status={p.status}>{p.status}</Badge></td>
                  <td>{p.variantCount ?? '—'}</td>
                  <td>
                    <div className="admin-table-actions">
                      <button className="btn btn-sm btn-secondary" onClick={() => navigate(`/admin/products/${p._id}/edit`)}>Sửa</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(p._id)}>Xóa</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
