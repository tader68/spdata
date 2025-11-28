#!/bin/bash
# Script khởi động cả Backend và Frontend cùng lúc
# Dành cho Linux/Mac

echo "========================================"
echo "  QA Data Labeling System"
echo "  Đang khởi động..."
echo "========================================"
echo ""

# Kiểm tra Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python chưa được cài đặt!"
    echo "Vui lòng cài đặt Python từ https://www.python.org/"
    exit 1
fi

# Kiểm tra Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js chưa được cài đặt!"
    echo "Vui lòng cài đặt Node.js từ https://nodejs.org/"
    exit 1
fi

echo "[1/4] Kiểm tra dependencies..."
echo ""

# Kiểm tra backend dependencies
cd backend
if ! python3 -c "import flask" &> /dev/null; then
    echo "[INFO] Đang cài đặt backend dependencies..."
    pip3 install -r requirements.txt
fi
cd ..

# Kiểm tra frontend dependencies
cd frontend
if [ ! -d "node_modules" ]; then
    echo "[INFO] Đang cài đặt frontend dependencies..."
    npm install
fi
cd ..

echo ""
echo "[2/4] Tạo thư mục cần thiết..."
mkdir -p backend/uploads
mkdir -p backend/results

echo ""
echo "[3/4] Khởi động Backend (Flask)..."
cd backend
python3 app.py &
BACKEND_PID=$!
cd ..

# Đợi 3 giây để backend khởi động
sleep 3

echo ""
echo "[4/4] Khởi động Frontend (React)..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "========================================"
echo "  HOÀN THÀNH!"
echo "========================================"
echo ""
echo "Backend: http://localhost:5000"
echo "Frontend: http://localhost:3000"
echo ""
echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo ""
echo "Để tắt server, nhấn Ctrl+C"
echo ""

# Đợi user nhấn Ctrl+C
trap "echo ''; echo 'Đang tắt servers...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT

# Giữ script chạy
wait
