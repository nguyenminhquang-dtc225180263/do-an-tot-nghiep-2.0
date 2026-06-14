import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { productService } from '../../services/productService';
import { categoryService } from '../../services/categoryService';
import { adminService } from '../../services/adminService';
import { useToast } from '../../components/ui/Toast';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Spinner from '../../components/ui/Spinner';
import './ProductFormPage.css';

const emptyVariant = { size: '', color: '', sku: '', stock: 0, price: 0, image: '' };

const toVariantForm = (variant = {}) => ({
  size: variant.size || '',
  color: variant.color || '',
  sku: variant.sku || '',
  stock: variant.stock ?? 0,
  price: variant.price ?? 0,
  image: variant.image || '',
});

const buildVariantPayload = (variant) => ({
  size: variant.size.trim(),
  color: variant.color.trim(),
  sku: variant.sku.trim(),
  stock: Number(variant.stock),
  price: Number(variant.price),
  image: variant.image.trim(),
});

export default function ProductFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isEdit = !!id;
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ name: '', categoryId: '', targetGender: 'unisex', brand: '', description: '', images: '', status: 'active' });
  const [variants, setVariants] = useState([]);
  const [newV, setNewV] = useState(emptyVariant);
  const [editingVariantId, setEditingVariantId] = useState(null);
  const [editingV, setEditingV] = useState(emptyVariant);

  useEffect(() => { categoryService.getCategories().then(setCategories).catch(() => {}); }, []);

  useEffect(() => {
    if (isEdit) {
      productService.getProductBySlug(id)
        .then((data) => {
          const p = data.product || data;
          setForm({ name: p.name, categoryId: p.categoryId?._id || p.categoryId, targetGender: p.targetGender, brand: p.brand || '', description: p.description || '', images: (p.images || []).join(', '), status: p.status });
          setVariants(data.variants || []);
        })
        .finally(() => setLoading(false));
    }
  }, [id, isEdit]);

  const refreshVariants = async () => {
    const data = await productService.getProductBySlug(id);
    setVariants(data.variants || []);
  };

  const validateVariant = (variant) => {
    if (!variant.size || !variant.color || !variant.sku || !variant.image) {
      toast('Vui lòng nhập đủ Size, Màu, SKU và Ảnh variant', 'error');
      return false;
    }
    if (!Number.isInteger(variant.stock) || variant.stock < 0) {
      toast('Số lượng phải là số nguyên không âm', 'error');
      return false;
    }
    if (!Number.isFinite(variant.price) || variant.price < 0) {
      toast('Giá phải là số không âm', 'error');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = { ...form, images: form.images.split(',').map((s) => s.trim()).filter(Boolean) };
      if (isEdit) { await adminService.updateProduct(id, payload); toast('Đã cập nhật sản phẩm'); }
      else { await adminService.createProduct(payload); toast('Đã tạo sản phẩm'); }
      navigate('/admin/products');
    } catch (err) { toast(err.message, 'error'); }
    setSubmitting(false);
  };

  const addVariant = async () => {
    const productId = id;
    if (!productId) { toast('Lưu sản phẩm trước khi thêm variant', 'error'); return; }
    try {
      const payload = buildVariantPayload(newV);
      if (!validateVariant(payload)) return;
      await adminService.createVariant(productId, payload);
      toast('Đã thêm variant');
      setNewV(emptyVariant);
      await refreshVariants();
    } catch (err) { toast(err.message, 'error'); }
  };

  const startEditVariant = (variant) => {
    setEditingVariantId(variant._id);
    setEditingV(toVariantForm(variant));
  };

  const cancelEditVariant = () => {
    setEditingVariantId(null);
    setEditingV(emptyVariant);
  };

  const saveVariant = async (variantId) => {
    try {
      const payload = buildVariantPayload(editingV);
      if (!validateVariant(payload)) return;
      await adminService.updateVariant(variantId, payload);
      await adminService.updateStock(variantId, { stock: payload.stock });
      toast('Đã cập nhật variant');
      cancelEditVariant();
      await refreshVariants();
    } catch (err) { toast(err.message, 'error'); }
  };

  const deleteVariant = async (vid) => {
    try { await adminService.deleteVariant(vid); toast('Đã xóa variant'); setVariants(variants.filter((v) => v._id !== vid)); } catch (err) { toast(err.message, 'error'); }
  };

  if (loading) return <div className="page-loading"><Spinner /></div>;

  const set = (k, v) => setForm({ ...form, [k]: v });
  const setNewVariant = (k, v) => setNewV({ ...newV, [k]: v });
  const setEditingVariant = (k, v) => setEditingV({ ...editingV, [k]: v });
  const formatPrice = (price) => new Intl.NumberFormat('vi-VN').format(price);

  return (
    <div className="product-form-page">
      <h1 className="page-title">{isEdit ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}</h1>
      <form onSubmit={handleSubmit}>
        <div className="pf-section">
          <h2>Thông tin cơ bản</h2>
          <div className="pf-grid">
            <Input label="Tên sản phẩm" value={form.name} onChange={(e) => set('name', e.target.value)} required />
            <div className="input-group">
              <label>Danh mục</label>
              <select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)} required>
                <option value="">Chọn danh mục</option>
                {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label>Giới tính</label>
              <select value={form.targetGender} onChange={(e) => set('targetGender', e.target.value)}>
                {['men', 'women', 'unisex', 'kids'].map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <Input label="Thương hiệu" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
            <div className="input-group">
              <label>Trạng thái</label>
              <select value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: 'var(--space-md)' }}><Input label="Mô tả" type="textarea" value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
          <div style={{ marginTop: 'var(--space-md)' }}><Input label="Ảnh (URLs, cách nhau bằng dấu phẩy)" value={form.images} onChange={(e) => set('images', e.target.value)} /></div>
        </div>
        <Button type="submit" loading={submitting}>{isEdit ? 'Cập nhật' : 'Tạo sản phẩm'}</Button>
        <Button type="button" variant="secondary" style={{ marginLeft: 8 }} onClick={() => navigate('/admin/products')}>Hủy</Button>
      </form>

      {isEdit && (
        <div className="pf-section" style={{ marginTop: 'var(--space-lg)' }}>
          <h2>Variants ({variants.length})</h2>
          {variants.map((v) => (
            <div key={v._id} className="pf-variant">
              {editingVariantId === v._id ? (
                <>
                  <Input placeholder="Size" value={editingV.size} onChange={(e) => setEditingVariant('size', e.target.value)} />
                  <Input placeholder="Màu" value={editingV.color} onChange={(e) => setEditingVariant('color', e.target.value)} />
                  <Input placeholder="SKU" value={editingV.sku} onChange={(e) => setEditingVariant('sku', e.target.value)} />
                  <Input placeholder="Số lượng" type="number" min="0" onChange={(e) => setEditingVariant('stock', e.target.value)} />
                  <Input placeholder="Giá" type="number" min="0" onChange={(e) => setEditingVariant('price', e.target.value)} />
                  <Input placeholder="URL ảnh sản phẩm" value={editingV.image} onChange={(e) => setEditingVariant('image', e.target.value)} />
                  <div className="pf-variant-actions">
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => saveVariant(v._id)}>Lưu</button>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={cancelEditVariant}>Hủy</button>
                  </div>
                </>
              ) : (
                <>
                  <span>{v.size}</span>
                  <span>{v.color}</span>
                  <span>{v.sku}</span>
                  <span>Tồn: {v.stock}</span>
                  <span>{formatPrice(v.price)}đ</span>
                  <span className="pf-variant-image">{v.image ? 'Có ảnh' : 'Chưa ảnh'}</span>
                  <div className="pf-variant-actions">
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => startEditVariant(v)}>Sửa</button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => deleteVariant(v._id)}>Xóa</button>
                  </div>
                </>
              )}
            </div>
          ))}
          <div className="pf-variant" style={{ borderBottom: 'none', paddingTop: 'var(--space-md)' }}>
            <Input placeholder="Size" value={newV.size} onChange={(e) => setNewVariant('size', e.target.value)} />
            <Input placeholder="Màu" value={newV.color} onChange={(e) => setNewVariant('color', e.target.value)} />
            <Input placeholder="SKU" value={newV.sku} onChange={(e) => setNewVariant('sku', e.target.value)} />
            <Input placeholder="Số lượng" type="number" min="0" onChange={(e) => setNewVariant('stock', e.target.value)} />
            <Input placeholder="Giá" type="number" min="0" onChange={(e) => setNewVariant('price', e.target.value)} />
            <Input placeholder="URL ảnh sản phẩm" value={newV.image} onChange={(e) => setNewVariant('image', e.target.value)} />
            <Button type="button" size="sm" onClick={addVariant}>Thêm</Button>
          </div>
        </div>
      )}
    </div>
  );
}
