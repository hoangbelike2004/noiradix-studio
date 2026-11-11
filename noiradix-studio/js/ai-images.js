/** Image attachments stay in memory and use data URLs, never remote fetches. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.AiImages = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const maxImages = 3, maxDataUrlLength = 1400000;
  function validate(image) {
    const dataUrl = image?.dataUrl;
    if (typeof dataUrl !== 'string' || dataUrl.length > maxDataUrlLength) throw new Error('Ảnh đính kèm quá lớn. Hãy chọn ảnh nhỏ hơn.');
    const match = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || match[2].length % 4 !== 0) throw new Error('Chỉ nhận ảnh PNG, JPG hoặc WebP hợp lệ.');
    const valid = match[1] === 'png' ? match[2].startsWith('iVBORw0KGgo') : match[1] === 'jpeg' ? match[2].startsWith('/9j/') : match[2].startsWith('UklGR');
    if (!valid) throw new Error('Dữ liệu ảnh đính kèm không hợp lệ.');
    return { name: typeof image.name === 'string' ? image.name.slice(0, 160) : 'Ảnh tham khảo', dataUrl };
  }
  function validateList(images = []) {
    if (!Array.isArray(images) || images.length > maxImages) throw new Error(`Mỗi tin nhắn nhận tối đa ${maxImages} ảnh.`);
    return images.map(validate);
  }
  async function fromFile(file) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 25 * 1024 * 1024) throw new Error('Chọn ảnh PNG, JPG hoặc WebP dưới 25 MB.');
    const url = URL.createObjectURL(file), img = new Image();
    try {
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('Không đọc được ảnh này.')); img.src = url; });
      if (!img.width || !img.height || img.width > 16384 || img.height > 16384) throw new Error('Kích thước ảnh quá lớn. Hãy dùng ảnh tối đa 16384×16384.');
      const canvas = document.createElement('canvas');
      let scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      for (let attempt = 0; attempt < 6; attempt++, scale *= 0.75) {
        canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.85);
        if (dataUrl.length <= maxDataUrlLength) return validate({ name: file.name, dataUrl });
      }
      throw new Error('Ảnh vẫn quá lớn sau khi thu nhỏ. Hãy chọn ảnh khác.');
    } finally { URL.revokeObjectURL(url); }
  }
  return { maxImages, maxDataUrlLength, validate, validateList, fromFile };
});
