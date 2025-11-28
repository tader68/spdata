# Hướng dẫn cài đặt chi tiết

## Bước 1: Cài đặt Python và Node.js

### Windows

**Python:**
1. Tải Python 3.8+ từ: https://www.python.org/downloads/
2. Chạy installer, **QUAN TRỌNG**: Tick vào "Add Python to PATH"
3. Kiểm tra cài đặt:
```bash
python --version
pip --version
```

**Node.js:**
1. Tải Node.js 16+ từ: https://nodejs.org/
2. Chạy installer (chọn tất cả options mặc định)
3. Kiểm tra cài đặt:
```bash
node --version
npm --version
```

## Bước 2: Clone hoặc tải project

```bash
# Nếu có Git
git clone <repository-url>
cd spd

# Hoặc tải ZIP và giải nén
```

## Bước 3: Cài đặt Backend

```bash
# Mở Command Prompt hoặc PowerShell
cd d:\Abc\spd\backend

# Cài đặt các thư viện Python (KHÔNG dùng venv)
pip install -r requirements.txt
```

**Lưu ý:** Nếu gặp lỗi permission, chạy với quyền Administrator hoặc thêm `--user`:
```bash
pip install --user -r requirements.txt
```

## Bước 4: Cài đặt Frontend

```bash
# Mở Command Prompt hoặc PowerShell mới
cd d:\Abc\spd\frontend

# Cài đặt dependencies
npm install
```

**Lưu ý:** Quá trình này có thể mất 2-5 phút tùy tốc độ mạng.

## Bước 5: Chạy ứng dụng

### Chạy Backend (Terminal 1)

```bash
cd d:\Abc\spd\backend
python app.py
```

Bạn sẽ thấy:
```
==================================================
🚀 Server QA Data Labeling đang khởi động...
📍 URL: http://localhost:5000
==================================================
 * Running on http://0.0.0.0:5000
```

**Để terminal này mở và chạy!**

### Chạy Frontend (Terminal 2)

Mở Command Prompt/PowerShell mới:

```bash
cd d:\Abc\spd\frontend
npm run dev
```

Bạn sẽ thấy:
```
  VITE v5.0.8  ready in 500 ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
```

## Bước 6: Truy cập ứng dụng

Mở trình duyệt và truy cập: **http://localhost:3000**

## Xử lý lỗi thường gặp

### Lỗi: "pip is not recognized"
**Giải pháp:**
1. Cài lại Python, nhớ tick "Add Python to PATH"
2. Hoặc thêm Python vào PATH thủ công:
   - Tìm đường dẫn Python (thường là `C:\Users\<user>\AppData\Local\Programs\Python\Python3X\`)
   - Thêm vào Environment Variables

### Lỗi: "npm is not recognized"
**Giải pháp:**
1. Cài lại Node.js
2. Restart terminal sau khi cài

### Lỗi: "Port 5000 already in use"
**Giải pháp:**
1. Tìm process đang dùng port 5000:
```bash
# Windows
netstat -ano | findstr :5000
taskkill /PID <PID> /F
```
2. Hoặc đổi port trong `backend/app.py`:
```python
app.run(debug=True, host='0.0.0.0', port=5001)  # Đổi sang 5001
```

### Lỗi: "Port 3000 already in use"
**Giải pháp:**
1. Đổi port trong `frontend/vite.config.js`:
```javascript
server: {
  port: 3001,  // Đổi sang 3001
}
```

### Lỗi: "Module not found: PyPDF2"
**Giải pháp:**
```bash
pip install PyPDF2
```

### Lỗi: "Module not found: python-docx"
**Giải pháp:**
```bash
pip install python-docx
```

## Kiểm tra cài đặt thành công

1. **Backend:** Truy cập http://localhost:5000/api/health
   - Nếu thấy `{"status": "ok", ...}` => Backend OK

2. **Frontend:** Truy cập http://localhost:3000
   - Nếu thấy giao diện website => Frontend OK

3. **Kết nối:** Click vào các nút trong website
   - Nếu không có lỗi CORS => Kết nối OK

## Chuẩn bị API Keys

### ChatGPT (OpenAI)

1. Truy cập: https://platform.openai.com/
2. Đăng ký/Đăng nhập
3. Vào: https://platform.openai.com/api-keys
4. Click "Create new secret key"
5. Copy key (bắt đầu bằng `sk-...`)
6. **Lưu ý:** Cần nạp credit để sử dụng

### Gemini (Google)

1. Truy cập: https://makersuite.google.com/
2. Đăng nhập bằng Google account
3. Vào: https://makersuite.google.com/app/apikey
4. Click "Create API key"
5. Copy key
6. **Lưu ý:** Free tier có giới hạn requests

## Chạy lần đầu

1. Mở 2 terminals
2. Terminal 1: Chạy backend
3. Terminal 2: Chạy frontend
4. Mở browser: http://localhost:3000
5. Upload file test để thử nghiệm

## Tips

- **Tắt ứng dụng:** Nhấn `Ctrl+C` trong terminal
- **Restart:** Tắt và chạy lại lệnh
- **Check logs:** Xem terminal để debug lỗi
- **Clear cache:** Xóa thư mục `backend/uploads/` và `backend/results/` nếu cần

## Hỗ trợ

Nếu gặp vấn đề:
1. Kiểm tra lại từng bước
2. Đọc error message trong terminal
3. Google error message
4. Kiểm tra firewall/antivirus có block không

---

**Chúc bạn cài đặt thành công! 🎉**
