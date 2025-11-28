"""
Module tích hợp AI: ChatGPT và Gemini
Xử lý việc gọi API và nhận response từ các model AI
"""

import os
import json
import time
from typing import Dict, List, Any, Optional
import base64

from .rate_limiter import RateLimiter

# Import thư viện cho OpenAI (ChatGPT)
try:
    import openai
except ImportError:
    openai = None

# Import thư viện cho Google Gemini
try:
    import google.generativeai as genai
except ImportError:
    genai = None

class AIIntegration:
    """Class tích hợp với các AI model (ChatGPT, Gemini)."""

    # Rate limiter dùng chung cho toàn bộ process, key theo (provider, model_version)
    _rate_limiters: Dict[str, RateLimiter] = {}

    @staticmethod
    def _get_gemini_rpm(model_to_use: str) -> int:
        """Lấy giới hạn RPM mặc định cho Gemini theo free-tier (có thể override bằng env).

        Tham số môi trường (nếu đặt) sẽ được ưu tiên:
        - GEMINI_25_PRO_RPM
        - GEMINI_25_FLASH_RPM
        - GEMINI_25_FLASH_LITE_RPM
        - GEMINI_20_FLASH_RPM
        - GEMINI_20_FLASH_LITE_RPM
        - GEMINI_RPM_DEFAULT
        """
        env_default = os.getenv("GEMINI_RPM_DEFAULT")
        default_rpm = int(env_default) if env_default and env_default.isdigit() else 0

        # Giá trị theo bảng Free Tier:
        # - Gemini 2.5 Pro:        2 RPM
        # - Gemini 2.5 Flash:     10 RPM
        # - Gemini 2.5 Flash-Lite:15 RPM
        # - Gemini 2.0 Flash:     15 RPM
        # - Gemini 2.0 Flash-Lite:30 RPM
        model_lower = (model_to_use or "").lower()

        if "2.5" in model_lower and "pro" in model_lower:
            env_val = os.getenv("GEMINI_25_PRO_RPM")
            return int(env_val) if env_val and env_val.isdigit() else (default_rpm or 2)

        # Check flash-lite 2.5 trước để không bị khớp với pattern flash chung
        if "2.5" in model_lower and "flash-lite" in model_lower:
            env_val = os.getenv("GEMINI_25_FLASH_LITE_RPM")
            return int(env_val) if env_val and env_val.isdigit() else (default_rpm or 15)

        if "2.5" in model_lower and "flash" in model_lower:
            env_val = os.getenv("GEMINI_25_FLASH_RPM")
            return int(env_val) if env_val and env_val.isdigit() else (default_rpm or 10)

        # 2.0 Flash / Flash-Lite
        if "2.0" in model_lower and "flash-lite" in model_lower:
            env_val = os.getenv("GEMINI_20_FLASH_LITE_RPM")
            return int(env_val) if env_val and env_val.isdigit() else (default_rpm or 30)

        if "2.0" in model_lower and "flash" in model_lower:
            env_val = os.getenv("GEMINI_20_FLASH_RPM")
            return int(env_val) if env_val and env_val.isdigit() else (default_rpm or 15)

        # Fallback cho các model Gemini khác
        return default_rpm or 10

    @staticmethod
    def get_gemini_rpd(model_to_use: str) -> int:
        """Lấy giới hạn RPD (requests per day) mặc định cho Gemini free-tier.

        Cho phép override bằng các biến môi trường:
        - GEMINI_25_PRO_RPD
        - GEMINI_25_FLASH_RPD
        - GEMINI_25_FLASH_LITE_RPD
        - GEMINI_20_FLASH_RPD
        - GEMINI_20_FLASH_LITE_RPD
        - GEMINI_RPD_DEFAULT
        """
        env_default = os.getenv("GEMINI_RPD_DEFAULT")
        default_rpd = int(env_default) if env_default and env_default.isdigit() else 0

        # Theo bảng Free Tier trong docs:
        # - Gemini 2.5 Pro:          50 RPD
        # - Gemini 2.5 Flash:       250 RPD
        # - Gemini 2.5 Flash-Lite: 1000 RPD
        # - Gemini 2.0 Flash:       200 RPD
        # - Gemini 2.0 Flash-Lite:  200 RPD
        model_lower = (model_to_use or "").lower()

        if "2.5" in model_lower and "pro" in model_lower:
            env_val = os.getenv("GEMINI_25_PRO_RPD")
            return int(env_val) if env_val and env_val.isdigit() else (default_rpd or 50)

        if "2.5" in model_lower and "flash-lite" in model_lower:
            env_val = os.getenv("GEMINI_25_FLASH_LITE_RPD")
            return int(env_val) if env_val and env_val.isdigit() else (default_rpd or 1000)

        if "2.5" in model_lower and "flash" in model_lower:
            env_val = os.getenv("GEMINI_25_FLASH_RPD")
            return int(env_val) if env_val and env_val.isdigit() else (default_rpd or 250)

        if "2.0" in model_lower and "flash-lite" in model_lower:
            env_val = os.getenv("GEMINI_20_FLASH_LITE_RPD")
            return int(env_val) if env_val and env_val.isdigit() else (default_rpd or 200)

        if "2.0" in model_lower and "flash" in model_lower:
            env_val = os.getenv("GEMINI_20_FLASH_RPD")
            return int(env_val) if env_val and env_val.isdigit() else (default_rpd or 200)

        # Fallback chung cho các model khác
        return default_rpd or 200

    def __init__(self, model_name: str, api_key: str, specific_model: str = None):
        """
        Khởi tạo AI Integration
        
        Args:
            model_name: Provider name ('chatgpt', 'gemini')
            api_key: API key của model
            specific_model: Tên model cụ thể (ví dụ: 'gpt-4o', 'gemini-2.5-flash')
        """
        self.model_name = model_name.lower()
        self.api_key = api_key
        
        # Cấu hình model
        if self.model_name == 'chatgpt':
            if openai is None:
                raise ImportError("Cần cài đặt openai: pip install openai")
            self.client = openai.OpenAI(api_key=api_key)
            # Sử dụng specific_model hoặc default
            self.model_version = specific_model or "gpt-4o"
        
        elif self.model_name == 'gemini':
            if genai is None:
                raise ImportError("Cần cài đặt google-generativeai: pip install google-generativeai")
            genai.configure(api_key=api_key)

            # Cấu hình safety_settings giống PromptGenerator để hạn chế bị block quá mức
            safety_settings = [
                {
                    "category": "HARM_CATEGORY_HARASSMENT",
                    "threshold": "BLOCK_NONE"
                },
                {
                    "category": "HARM_CATEGORY_HATE_SPEECH",
                    "threshold": "BLOCK_NONE"
                },
                {
                    "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    "threshold": "BLOCK_NONE"
                },
                {
                    "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
                    "threshold": "BLOCK_NONE"
                }
            ]

            # Sử dụng specific_model hoặc default
            model_to_use = specific_model or 'gemini-2.5-flash'
            self.model = genai.GenerativeModel(
                model_name=model_to_use,
                safety_settings=safety_settings
            )
            self.model_version = model_to_use

            # Thiết lập rate limiter theo model Gemini đang dùng
            key = f"gemini:{self.model_version}"
            rpm = self._get_gemini_rpm(self.model_version)
            if key not in AIIntegration._rate_limiters:
                AIIntegration._rate_limiters[key] = RateLimiter(max_rpm=rpm)
            self._rate_limiter = AIIntegration._rate_limiters[key]
        
        else:
            raise ValueError(f"Model {model_name} không được hỗ trợ. Chỉ hỗ trợ 'chatgpt' hoặc 'gemini'")
    
    def generate_response(self, prompt: str, context: Optional[str] = None) -> str:
        """
        Sinh response từ AI model
        
        Args:
            prompt: Prompt gửi đến AI
            context: Context bổ sung (optional)
            
        Returns:
            Response từ AI
        """
        try:
            if self.model_name == 'chatgpt':
                return self._chatgpt_generate(prompt, context)
            elif self.model_name == 'gemini':
                return self._gemini_generate(prompt, context)
        except Exception as e:
            raise Exception(f"Lỗi khi gọi AI {self.model_name}: {str(e)}")
    
    def _chatgpt_generate(self, prompt: str, context: Optional[str] = None) -> str:
        """
        Sinh response từ ChatGPT
        
        Args:
            prompt: Prompt gửi đến ChatGPT
            context: Context bổ sung
            
        Returns:
            Response từ ChatGPT
        """
        messages = []
        
        # Thêm context nếu có
        if context:
            messages.append({
                "role": "system",
                "content": f"Context: {context}"
            })
        
        # Thêm prompt chính
        messages.append({
            "role": "user",
            "content": prompt
        })
        
        # Gọi API
        response = self.client.chat.completions.create(
            model=self.model_version,
            messages=messages,
            temperature=0.3,  # Giảm nhiệt độ để có kết quả ổn định hơn
            max_tokens=4000
        )
        
        return response.choices[0].message.content
    
    def _gemini_generate(self, prompt: str, context: Optional[str] = None) -> str:
        """
        Sinh response từ Gemini
        
        Args:
            prompt: Prompt gửi đến Gemini
            context: Context bổ sung
            
        Returns:
            Response từ Gemini
        """
        # Kết hợp context và prompt
        full_prompt = prompt
        if context:
            full_prompt = f"Context: {context}\n\n{prompt}"

        # Gọi API với cơ chế retry nhẹ cho các lỗi tạm thời (timeout, 5xx, rate limit)
        max_retries = 2
        last_exception: Optional[Exception] = None
        transient_keywords = [
            'timeout',
            'timed out',
            '504',
            '503',
            '502',
            '429',
            'quota',
            'rate limit',
            'temporarily unavailable',
            'unavailable'
        ]

        for attempt in range(max_retries + 1):
            try:
                # Rate limit cho Gemini theo model hiện tại (free-tier RPM)
                if hasattr(self, '_rate_limiter') and self._rate_limiter is not None:
                    self._rate_limiter.acquire()

                response = self.model.generate_content(
                    full_prompt,
                    generation_config={
                        'temperature': 0.3,
                        'max_output_tokens': 4000,
                    }
                )
                # Trích xuất text an toàn, tránh lỗi quick accessor khi không có Part
                text = self._extract_gemini_text(response)

                # Nếu _extract_gemini_text trả về JSON fallback do không có nội dung
                # (ví dụ bị safety filter hoặc không có text), thử retry thêm lần nữa
                fallback_indicators = [
                    "Gemini không trả về nội dung text hợp lệ",
                    "Gemini không trả về nội dung do bị safety filter chặn"
                ]
                if any(indicator in text for indicator in fallback_indicators) and attempt < max_retries:
                    time.sleep(2 * (attempt + 1))
                    continue

                return text
            except Exception as e:
                last_exception = e
                msg = str(e).lower()
                is_transient = any(kw in msg for kw in transient_keywords)
                if is_transient and attempt < max_retries:
                    # Backoff nhẹ trước khi thử lại
                    time.sleep(2 * (attempt + 1))
                    continue
                # Nếu không phải lỗi tạm thời hoặc đã hết số lần retry, ném lại exception
                raise
    
    def generate_with_media(self, prompt: str, media_path: str, media_type: str) -> str:
        """
        Sinh response với media (image, audio, video)
        
        Args:
            prompt: Prompt gửi đến AI
            media_path: Đường dẫn đến file media
            media_type: Loại media ('image', 'audio', 'video')
            
        Returns:
            Response từ AI
        """
        try:
            if self.model_name == 'chatgpt':
                return self._chatgpt_generate_with_media(prompt, media_path, media_type)
            elif self.model_name == 'gemini':
                return self._gemini_generate_with_media(prompt, media_path, media_type)
        except Exception as e:
            raise Exception(f"Lỗi khi xử lý media với AI {self.model_name}: {str(e)}")
    
    def _chatgpt_generate_with_media(self, prompt: str, media_path: str, media_type: str) -> str:
        """
        Sinh response từ ChatGPT với media
        Hiện tại ChatGPT chỉ hỗ trợ image tốt
        
        Args:
            prompt: Prompt
            media_path: Đường dẫn media
            media_type: Loại media
            
        Returns:
            Response từ ChatGPT
        """
        if media_type == 'image':
            # Đọc và encode image
            with open(media_path, 'rb') as f:
                image_data = base64.b64encode(f.read()).decode('utf-8')
            
            # Xác định mime type
            ext = os.path.splitext(media_path)[1].lower()
            mime_types = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp'
            }
            mime_type = mime_types.get(ext, 'image/jpeg')
            
            # Gọi API với image
            response = self.client.chat.completions.create(
                model="gpt-4o",  # Model hỗ trợ vision
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{mime_type};base64,{image_data}"
                                }
                            }
                        ]
                    }
                ],
                max_tokens=4000
            )
            
            return response.choices[0].message.content
        
        else:
            # Với audio/video, ChatGPT cần xử lý khác hoặc dùng Whisper API
            return f"[ChatGPT chưa hỗ trợ trực tiếp {media_type}. Cần xử lý riêng.]"
    
    def _gemini_generate_with_media(self, prompt: str, media_path: str, media_type: str) -> str:
        """
        Sinh response từ Gemini với media
        Gemini hỗ trợ tốt cả image, audio, video
        
        Args:
            prompt: Prompt
            media_path: Đường dẫn media
            media_type: Loại media
            
        Returns:
            Response từ Gemini
        """
        # Upload file lên Gemini với display_name để dễ debug/quản lý
        uploaded_file = genai.upload_file(
            path=media_path,
            display_name=os.path.basename(media_path)
        )

        # Đợi file được xử lý, tránh loop vô hạn bằng timeout
        start_time = time.time()
        max_wait_seconds = 300  # 5 phút
        while uploaded_file.state.name == "PROCESSING":
            if time.time() - start_time > max_wait_seconds:
                try:
                    genai.delete_file(uploaded_file.name)
                except Exception:
                    pass
                raise TimeoutError(f"Quá thời gian chờ xử lý media {media_path} trên Gemini")
            time.sleep(1)
            uploaded_file = genai.get_file(uploaded_file.name)

        if uploaded_file.state.name == "FAILED":
            try:
                genai.delete_file(uploaded_file.name)
            except Exception:
                pass
            raise Exception(f"Không thể xử lý file {media_path} trên Gemini: trạng thái FAILED")

        # Sinh response với media (image/audio/video) với cơ chế retry nhẹ cho lỗi tạm thời
        try:
            max_retries = 2
            last_exception: Optional[Exception] = None
            transient_keywords = [
                'timeout',
                'timed out',
                '504',
                '503',
                '502',
                '429',
                'quota',
                'rate limit',
                'temporarily unavailable',
                'unavailable'
            ]

            for attempt in range(max_retries + 1):
                try:
                    # Rate limit cho Gemini theo model hiện tại (free-tier RPM)
                    if hasattr(self, '_rate_limiter') and self._rate_limiter is not None:
                        self._rate_limiter.acquire()

                    response = self.model.generate_content(
                        [prompt, uploaded_file],
                        generation_config={
                            'temperature': 0.3,
                            'max_output_tokens': 4000,
                        }
                    )
                    # Trích xuất text an toàn giống với _gemini_generate
                    text = self._extract_gemini_text(response)

                    fallback_indicators = [
                        "Gemini không trả về nội dung text hợp lệ",
                        "Gemini không trả về nội dung do bị safety filter chặn"
                    ]
                    if any(indicator in text for indicator in fallback_indicators) and attempt < max_retries:
                        time.sleep(2 * (attempt + 1))
                        continue

                    return text
                except Exception as e:
                    last_exception = e
                    msg = str(e).lower()
                    is_transient = any(kw in msg for kw in transient_keywords)
                    if is_transient and attempt < max_retries:
                        time.sleep(2 * (attempt + 1))
                        continue
                    raise
        finally:
            # Luôn cố gắng cleanup file trên Gemini sau khi dùng xong
            try:
                genai.delete_file(uploaded_file.name)
            except Exception:
                pass

    def _extract_gemini_text(self, response: Any) -> str:
        """Trích xuất text từ response Gemini một cách an toàn.

        - Ưu tiên lấy từ candidate đầu tiên, nối tất cả part.text nếu có.
        - Nếu không có bất kỳ phần text nào (thường do safety block), trả về
          một JSON fallback để pipeline QA không bị lỗi hệ thống.
        """
        # Cố gắng lấy text từ candidates/parts giống logic trong PromptGenerator
        try:
            candidates = getattr(response, 'candidates', None)
            if candidates:
                cand = candidates[0]

                # Nếu có content parts thì gom tất cả text lại
                content = getattr(cand, 'content', None)
                parts = getattr(content, 'parts', None) if content else None
                texts: List[str] = []
                if parts:
                    for part in parts:
                        text_part = getattr(part, 'text', None)
                        if isinstance(text_part, str) and text_part.strip():
                            texts.append(text_part.strip())

                if texts:
                    return "\n".join(texts).strip()

                # Không có text -> có thể do safety block hoặc lỗi nội dung
                finish_reason = getattr(cand, 'finish_reason', None)
                finish_name = getattr(finish_reason, 'name', '') if finish_reason else ''
                if finish_name == 'SAFETY':
                    # Bị safety filter chặn: trả về JSON fallback để QA hiểu là không đánh giá được
                    fallback = {
                        "is_correct": None,
                        "errors": [
                            "Gemini không trả về nội dung do bị safety filter chặn. Không thể đánh giá dòng dữ liệu này."
                        ],
                        "suggestions": [],
                        "violated_rules": [],
                        "confidence_score": 0,
                        "explanation": "Model Gemini trả về candidate bị SAFETY block và không có bất kỳ phần text nào, nên không thể sinh kết quả QA theo guideline."
                    }
                    return json.dumps(fallback, ensure_ascii=False)
        except Exception:
            # Bất kỳ lỗi gì trong quá trình trích xuất sẽ fallback ở dưới
            pass

        # Fallback chung: không có text, không rõ lý do -> trả về JSON trung tính để
        # pipeline vẫn chạy, thay vì ném exception hệ thống.
        generic_fallback = {
            "is_correct": None,
            "errors": [
                "Gemini không trả về nội dung text hợp lệ. Không thể đánh giá dòng dữ liệu này."
            ],
            "suggestions": [],
            "violated_rules": [],
            "confidence_score": 0,
            "explanation": "Model Gemini không cung cấp bất kỳ phần nội dung text nào trong response (có thể do lỗi nội bộ hoặc safety filter), nên hệ thống trả về kết quả trung tính thay vì lỗi hệ thống."
        }
        return json.dumps(generic_fallback, ensure_ascii=False)
    
    def batch_generate(self, prompts: List[str], context: Optional[str] = None) -> List[str]:
        """
        Sinh nhiều response cùng lúc (batch processing)
        
        Args:
            prompts: List các prompt
            context: Context chung
            
        Returns:
            List các response
        """
        responses = []
        
        for prompt in prompts:
            try:
                response = self.generate_response(prompt, context)
                responses.append(response)
            except Exception as e:
                responses.append(f"[Lỗi: {str(e)}]")
        
        return responses
    
    def validate_api_key(self) -> bool:
        """
        Kiểm tra API key có hợp lệ không
        
        Returns:
            True nếu API key hợp lệ
        """
        try:
            test_prompt = "Hello"
            self.generate_response(test_prompt)
            return True
        except Exception:
            return False
    
    def get_model_info(self) -> Dict[str, Any]:
        """
        Lấy thông tin về model đang sử dụng
        
        Returns:
            Dictionary chứa thông tin model
        """
        info = {
            'model_name': self.model_name,
            'api_key_valid': self.validate_api_key()
        }
        
        info['model_version'] = self.model_version
        
        return info
