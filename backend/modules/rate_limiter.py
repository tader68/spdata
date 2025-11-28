import threading
import time
from typing import Optional


class RateLimiter:
    """Rate limiter cực đơn giản theo đơn vị requests per minute (RPM).

    Áp dụng chung cho mỗi provider/model. Mục tiêu là tránh bắn quá nhanh gây 429/quota
    với các API như Gemini (free-tier).
    """

    def __init__(self, max_rpm: Optional[int] = None):
        # max_rpm = None nghĩa là không giới hạn (bỏ qua limiter)
        self.max_rpm = max_rpm or 0
        self._lock = threading.Lock()
        self._timestamps = []  # lưu timestamp (epoch seconds) của các lần gọi gần đây

    def set_limit(self, max_rpm: Optional[int]):
        """Cập nhật giới hạn RPM động (có thể dựa trên config/tier)."""
        with self._lock:
            self.max_rpm = max_rpm or 0

    def acquire(self):
        """Block (sleep) nếu cần để không vượt quá max_rpm.

        Đơn vị đo: trong bất kỳ khoảng 60 giây gần nhất không được quá max_rpm lần gọi.
        """
        if not self.max_rpm or self.max_rpm <= 0:
            return

        with self._lock:
            now = time.time()
            window_start = now - 60

            # Loại bỏ các lần gọi cũ ngoài cửa sổ 60s
            self._timestamps = [t for t in self._timestamps if t >= window_start]

            if len(self._timestamps) < self.max_rpm:
                # Còn slot -> ghi lại thời điểm và cho qua
                self._timestamps.append(now)
                return

            # Đã đầy số request trong 60s -> tính thời gian phải chờ đến khi request
            # cũ nhất rơi ra khỏi cửa sổ 60s
            oldest = min(self._timestamps)
            wait_seconds = (oldest + 60) - now
            if wait_seconds > 0:
                time.sleep(wait_seconds)

            # Sau khi sleep, cập nhật lại cửa sổ và thêm timestamp mới
            now = time.time()
            window_start = now - 60
            self._timestamps = [t for t in self._timestamps if t >= window_start]
            self._timestamps.append(now)
