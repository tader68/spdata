# QA Data Labeling System

Hệ thống kiểm soát chất lượng data labeling sử dụng AI (ChatGPT/Gemini) để tự động đánh giá và đối chiếu kết quả.

## 🌟 Tính năng chính

### I. QA Data
- **Upload Data Excel**: Hỗ trợ file Excel với 1-10,000 dòng data
- **Upload Guideline**: Hỗ trợ PDF, Excel, Word, TXT
- **Upload Media**: Hỗ trợ audio, image, video (1-10,000 files)
  - Import từng file, nhiều file hoặc cả folder
  - Tự động mapping với data Excel

### II. Kiểm tra với AI
- Chọn model AI (ChatGPT hoặc Gemini)
- Nhập API key
- Tự động sinh prompt từ guideline bằng Gemini
- Kiểm tra từng dòng data theo guideline

### III. Đối chiếu với 3 AI
- Cấu hình 3 model AI khác nhau
- Đối chiếu kết quả để đảm bảo độ chính xác
- Tính toán consensus giữa các AI

### IV. Kết quả & Export
- Hiển thị thống kê tổng quan
- Xem chi tiết từng dòng data
- Export kết quả ra Excel
- Quản lý danh sách projects

## 🏗️ Kiến trúc hệ thống

```
spd/
├── backend/                    # Backend Flask API
│   ├── app.py                 # File chính của API
│   ├── modules/               # Các module xử lý
│   │   ├── __init__.py
│   │   ├── file_handler.py    # Xử lý file upload/parse
│   │   ├── ai_integration.py  # Tích hợp ChatGPT/Gemini
│   │   ├── prompt_generator.py # Sinh prompt tự động
│   │   └── qa_processor.py    # Xử lý quy trình QA
│   ├── uploads/               # Thư mục lưu file upload
│   ├── results/               # Thư mục lưu kết quả
│   └── requirements.txt       # Dependencies Python
│
├── frontend/                  # Frontend React
│   ├── src/
│   │   ├── App.jsx           # Component chính
│   │   ├── main.jsx          # Entry point
│   │   ├── index.css         # Global styles
│   │   └── components/       # Các components
│   │       ├── UploadSection.jsx
│   │       ├── QAConfiguration.jsx
│   │       ├── VerificationSection.jsx
│   │       ├── ResultsView.jsx
│   │       └── ProjectsList.jsx
│   ├── package.json
│   ├── vite.config.js
│   └── tailwind.config.js
│
└── README.md                  # File này
```

## 📦 Cài đặt

### Yêu cầu hệ thống
- Python 3.8+
- Node.js 16+
- npm hoặc yarn

### Backend Setup

```bash
# Di chuyển vào thư mục backend
cd backend

# Cài đặt dependencies (KHÔNG dùng venv)
pip install -r requirements.txt

# Chạy server
python app.py
```

Server sẽ chạy tại: `http://localhost:5000`

### Frontend Setup

```bash
# Di chuyển vào thư mục frontend
cd frontend

# Cài đặt dependencies
npm install

# Chạy development server
npm run dev
```

Frontend sẽ chạy tại: `http://localhost:3000`

## 🚀 Sử dụng

### 1. Chuẩn bị dữ liệu

**File Data Excel:**
- Format: `.xlsx`, `.xls`, `.csv`
- Cấu trúc: Các cột chứa thông tin data đã được label
- Nếu có media: Thêm cột chứa tên file media

**File Guideline:**
- Format: `.pdf`, `.xlsx`, `.docx`, `.txt`
- Nội dung: Quy tắc, tiêu chí đánh giá chất lượng labeling

**Media Files (optional):**
- Format: Audio (`.mp3`, `.wav`, ...), Image (`.jpg`, `.png`, ...), Video (`.mp4`, `.avi`, ...)
- Tên file phải khớp với cột media trong Excel

### 2. Quy trình QA

#### Bước 1: Upload Data
1. Upload file data Excel
2. Upload file guideline
3. Upload media files (nếu có)

#### Bước 2: Cấu hình QA
1. Chọn model AI (ChatGPT hoặc Gemini)
2. Nhập API key
3. Sinh prompt tự động hoặc nhập thủ công
4. Bắt đầu QA

#### Bước 3: Đối chiếu
1. Đợi QA hoàn thành
2. Cấu hình 3 AI để đối chiếu
3. Bắt đầu verification

#### Bước 4: Xem kết quả
1. Xem thống kê tổng quan
2. Xem chi tiết từng dòng
3. Export kết quả ra Excel

### 3. API Keys

**ChatGPT (OpenAI):**
- Đăng ký tại: https://platform.openai.com/
- Tạo API key tại: https://platform.openai.com/api-keys

**Gemini (Google):**
- Đăng ký tại: https://makersuite.google.com/
- Tạo API key tại: https://makersuite.google.com/app/apikey

## 📚 API Endpoints

### Upload
- `POST /api/upload/data` - Upload file data Excel
- `POST /api/upload/guideline` - Upload file guideline
- `POST /api/upload/media` - Upload media files

### QA Processing
- `POST /api/generate-prompt` - Sinh prompt từ guideline
- `POST /api/qa/start` - Bắt đầu QA
- `POST /api/qa/verify` - Bắt đầu verification
- `GET /api/qa/status/<qa_id>` - Lấy trạng thái QA
- `GET /api/qa/result/<qa_id>` - Lấy kết quả QA
- `GET /api/qa/export/<qa_id>` - Export kết quả

### Projects
- `GET /api/projects` - Liệt kê tất cả projects

## 🎨 Công nghệ sử dụng

### Backend
- **Flask**: Web framework
- **Pandas**: Xử lý data Excel
- **PyPDF2**: Đọc file PDF
- **python-docx**: Đọc file Word
- **OpenAI API**: Tích hợp ChatGPT
- **Google Generative AI**: Tích hợp Gemini

### Frontend
- **React**: UI framework
- **Vite**: Build tool
- **TailwindCSS**: Styling
- **Lucide React**: Icons
- **Axios**: HTTP client
- **React Dropzone**: File upload

## 🔧 Cấu hình nâng cao

### Thay đổi model version

**Backend (`modules/ai_integration.py`):**
```python
# ChatGPT
self.model_version = "gpt-4o"  # Có thể đổi sang gpt-4, gpt-3.5-turbo

# Gemini
self.model = genai.GenerativeModel('gemini-1.5-pro')  # Có thể đổi model
```

### Tăng giới hạn file size

**Backend (`app.py`):**
```python
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB
```

### Thay đổi port

**Backend:**
```python
app.run(debug=True, host='0.0.0.0', port=5000)  # Đổi port ở đây
```

**Frontend (`vite.config.js`):**
```javascript
server: {
  port: 3000,  // Đổi port ở đây
  proxy: {
    '/api': {
      target: 'http://localhost:5000',  // Cập nhật backend URL
    }
  }
}
```

## 🐛 Xử lý lỗi thường gặp

### Lỗi: "Module not found"
```bash
# Cài đặt lại dependencies
pip install -r requirements.txt
```

### Lỗi: "API key invalid"
- Kiểm tra API key đã nhập đúng chưa
- Kiểm tra API key còn credit không
- Kiểm tra model có được enable không

### Lỗi: "File too large"
- Tăng `MAX_CONTENT_LENGTH` trong `app.py`
- Chia nhỏ file data thành nhiều phần

### Lỗi: "CORS"
- Kiểm tra `flask-cors` đã được cài đặt
- Kiểm tra frontend đang gọi đúng URL backend

## 📝 Lưu ý

1. **Không sử dụng virtual environment**: Hệ thống được thiết kế để chạy trực tiếp, không cần `.venv`

2. **API Keys**: Không commit API keys vào Git. Sử dụng environment variables trong production.

3. **Performance**: 
   - Với data lớn (>1000 dòng), quá trình QA có thể mất nhiều thời gian
   - Hệ thống xử lý song song để tối ưu tốc độ

4. **Cost**: Mỗi lần gọi AI sẽ tốn token. Ước tính:
   - 1 dòng data ≈ 500-1000 tokens
   - 1000 dòng ≈ 500k-1M tokens

5. **Media Processing**: 
   - ChatGPT chỉ hỗ trợ tốt image
   - Gemini hỗ trợ đầy đủ audio, image, video

## 🤝 Đóng góp

Hệ thống được thiết kế theo kiến trúc module để dễ dàng mở rộng:

- Thêm AI model mới: Chỉnh sửa `ai_integration.py`
- Thêm loại file mới: Chỉnh sửa `file_handler.py`
- Thêm tính năng QA: Chỉnh sửa `qa_processor.py`
- Thêm UI component: Tạo file mới trong `frontend/src/components/`

## 📄 License

MIT License - Tự do sử dụng và phát triển

## 👨‍💻 Tác giả

Phát triển bởi AI Assistant với ❤️

---

**Chúc bạn sử dụng hiệu quả! 🚀**
