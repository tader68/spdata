"""
Module sinh prompt tự động từ guideline
Sử dụng Gemini để phân tích guideline và tạo prompt phù hợp
"""

import json
import os
from typing import Dict, Any, List

try:
    import google.generativeai as genai
except ImportError:
    genai = None

class PromptGenerator:
    """
    Class sinh prompt tự động từ guideline
    """
    
    def __init__(self):
        """
        Khởi tạo PromptGenerator
        """
        self.system_prompt = """
Bạn là một chuyên gia về Data Quality Assurance và Prompt Engineering.
Nhiệm vụ của bạn là phân tích guideline được cung cấp và tạo ra một prompt chi tiết, 
rõ ràng để AI có thể kiểm tra chất lượng data labeling theo đúng guideline đó.

Prompt cần:
1. Mô tả rõ ràng các tiêu chí đánh giá
2. Liệt kê các lỗi thường gặp cần kiểm tra
3. Đưa ra format output cụ thể (JSON)
4. Yêu cầu AI giải thích lý do khi phát hiện lỗi

NGUYÊN TẮC QUAN TRỌNG:
- Tuyệt đối KHÔNG được tự nghĩ thêm quy tắc hoặc ví dụ nếu trong guideline không có.
- Bất kỳ nhận định đúng/sai nào cũng phải dựa trên nội dung thực tế của guideline.
- Nếu guideline KHÔNG quy định rõ cho một trường hợp, hãy ghi rõ điều đó trong phần giải thích
  (ví dụ: "Guideline không có quy định rõ cho trường hợp này"), không phán đoán thêm.
- Đặc biệt với nhãn "OTHER": nếu guideline có phần mô tả riêng cho "OTHER" thì phải bám sát đúng
  nội dung đó, không tự áp đặt quy tắc chung (ví dụ bắt buộc các field khác phải null) nếu văn bản
  guideline không nói tới.

Format output mong muốn:
{
    "is_correct": true/false,
    "errors": ["lỗi 1", "lỗi 2", ...],
    "suggestions": ["gợi ý 1", "gợi ý 2", ...],
    "confidence_score": 0-100,
    "explanation": "Giải thích chi tiết"
}
"""
    
    def generate_from_guideline(self, guideline_content: str, api_key: str, model_name: str = 'gemini-2.5-flash', guideline_file_path: str = None) -> str:
        """
        Sinh prompt từ nội dung guideline sử dụng Gemini
        
        Args:
            guideline_content: Nội dung guideline (fallback)
            api_key: API key của Gemini
            model_name: Tên model Gemini cụ thể
            guideline_file_path: Đường dẫn file guideline (ưu tiên dùng File API)
            
        Returns:
            Prompt được sinh ra
        """
        if genai is None:
            raise ImportError("Cần cài đặt google-generativeai: pip install google-generativeai")
        
        # Cấu hình Gemini
        genai.configure(api_key=api_key)
        
        # Cấu hình safety settings để tránh bị block
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
        
        model = genai.GenerativeModel(
            model_name=model_name,
            safety_settings=safety_settings
        )
        
        # Tạo prompt instruction
        instruction_prompt = f"""
{self.system_prompt}

Hãy phân tích file guideline được cung cấp và tạo một prompt chi tiết để AI có thể kiểm tra chất lượng data labeling theo guideline đó.

Prompt cần bao gồm:
1. Mô tả nhiệm vụ
2. Các tiêu chí đánh giá cụ thể từ guideline
3. Các lỗi thường gặp cần kiểm tra
4. Format output (JSON) như đã mô tả ở trên
5. Yêu cầu về độ chi tiết của giải thích

Chỉ trả về prompt, không thêm bất kỳ giải thích nào khác.
"""
        
        # Thử sử dụng File API nếu có file path
        if guideline_file_path and os.path.exists(guideline_file_path):
            print(f"[INFO] Using File API for guideline: {guideline_file_path}", flush=True)
            try:
                # Upload file lên Gemini
                uploaded_file = genai.upload_file(
                    path=guideline_file_path,
                    display_name="Guideline Document"
                )
                print(f"[DEBUG] File uploaded: {uploaded_file.name}", flush=True)
                
                # Đợi file được xử lý
                import time
                while uploaded_file.state.name == "PROCESSING":
                    print("[DEBUG] File is processing...", flush=True)
                    time.sleep(2)
                    uploaded_file = genai.get_file(uploaded_file.name)
                
                if uploaded_file.state.name == "FAILED":
                    print("[ERROR] File processing failed, falling back to text content", flush=True)
                    raise Exception("File processing failed")
                
                print(f"[DEBUG] File ready: {uploaded_file.state.name}", flush=True)
                
                # Gọi Gemini với file
                response = model.generate_content(
                    [uploaded_file, instruction_prompt],
                    generation_config={
                        'temperature': 0.5,
                        'max_output_tokens': 8192,  # Tăng lên max để xử lý guideline dài (60k tokens)
                    }
                )
                
                # Cleanup file sau khi sử dụng
                try:
                    genai.delete_file(uploaded_file.name)
                    print("[DEBUG] File cleaned up", flush=True)
                except:
                    pass
                    
            except Exception as e:
                print(f"[WARNING] File API failed: {str(e)}, falling back to text content", flush=True)
                # Fallback to text content method
                return self._generate_with_text_content(guideline_content, model, instruction_prompt)
        else:
            print("[INFO] Using text content method", flush=True)
            return self._generate_with_text_content(guideline_content, model, instruction_prompt)
        
        # Xử lý response (chung cho cả File API và text content)
        return self._process_response(response, guideline_content)

    def generate_label_prompt(self, guideline_content: str, api_key: str, model_name: str = 'gemini-2.5-flash', guideline_file_path: str = None) -> str:
        """Sinh prompt cho nhiệm vụ LABELING (gán label) từ guideline.

        Cơ chế tương tự generate_from_guideline nhưng instruction tập trung vào việc
        AI phải gán nhãn mới cho data theo guideline, với output JSON dạng:
        {
          "labels": { ... },
          "explanation": "..."
        }
        """
        if genai is None:
            raise ImportError("Cần cài đặt google-generativeai: pip install google-generativeai")

        genai.configure(api_key=api_key)

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

        model = genai.GenerativeModel(
            model_name=model_name,
            safety_settings=safety_settings
        )

        instruction_prompt = f"""
Bạn là một chuyên gia về Data Labeling và Prompt Engineering.
Nhiệm vụ của bạn là phân tích guideline được cung cấp và tạo ra một prompt chi tiết,
rõ ràng để AI có thể GÁN LABEL mới cho từng dòng data theo đúng guideline đó.

Prompt cần:
1. Mô tả rõ nhiệm vụ gán nhãn (classification/tagging) dựa trên guideline.
2. Liệt kê rõ các loại nhãn/cate chính mà AI được phép sử dụng (nếu guideline có).
3. Giải thích cách sử dụng từng nhãn, đặc biệt là các nhóm như identity, document_type, v.v.
4. Định nghĩa FORMAT OUTPUT JSON bắt buộc cho mỗi dòng data theo dạng:
   {{
     "labels": {{
        "tag": "...",     // ví dụ: identity
        "cate1": "...",   // ví dụ: căn cước công dân
        "cate2": "..."    // các field phụ khác nếu guideline yêu cầu
     }},
     "explanation": "Giải thích ngắn gọn, tập trung lý do chọn các label trên"
   }}

Nguyên tắc quan trọng:
- Chỉ sử dụng các nhãn được định nghĩa trong guideline (hoặc nhóm nhãn được mô tả rõ).
- Không tự bịa thêm nhãn mới nếu guideline không đề cập.
- Nếu guideline không đủ rõ cho một trường hợp, hãy hướng dẫn AI ưu tiên chọn nhãn "OTHER"
  (hoặc nhãn tương đương) và ghi rõ sự mơ hồ trong phần explanation.
- Prompt cuối cùng phải yêu cầu AI CHỈ TRẢ VỀ JSON, không thêm text ngoài JSON.

Hãy phân tích guideline và tạo một prompt duy nhất theo các yêu cầu trên.
"""

        # Thử sử dụng File API nếu có file guideline (PDF/DOCX/TXT)
        if guideline_file_path and os.path.exists(guideline_file_path):
            print(f"[INFO] Using File API for LABEL guideline: {guideline_file_path}", flush=True)
            try:
                uploaded_file = genai.upload_file(
                    path=guideline_file_path,
                    display_name="Guideline Document for Labeling",
                )

                # Đợi file được xử lý, tránh loop vô hạn bằng timeout nhẹ
                import time
                start_time = time.time()
                max_wait_seconds = 300
                while uploaded_file.state.name == "PROCESSING":
                    if time.time() - start_time > max_wait_seconds:
                        raise TimeoutError("Quá thời gian chờ xử lý guideline cho LABEL prompt generation")
                    print("[DEBUG] LABEL guideline file is processing...", flush=True)
                    time.sleep(2)
                    uploaded_file = genai.get_file(uploaded_file.name)

                if uploaded_file.state.name == "FAILED":
                    print("[ERROR] LABEL guideline file processing failed, falling back to text content", flush=True)
                    raise RuntimeError("File processing failed for LABEL guideline")

                print(f"[DEBUG] LABEL guideline file ready: {uploaded_file.state.name}", flush=True)

                response = model.generate_content(
                    [uploaded_file, instruction_prompt],
                    generation_config={
                        "temperature": 0.5,
                        "max_output_tokens": 8192,
                    },
                )

                # Cleanup file sau khi sử dụng
                try:
                    genai.delete_file(uploaded_file.name)
                    print("[DEBUG] LABEL guideline file cleaned up", flush=True)
                except Exception:
                    pass

            except Exception as e:
                print(f"[WARNING] File API for LABEL prompt failed: {str(e)}, falling back to text content", flush=True)
                return self._generate_with_text_content(guideline_content, model, instruction_prompt)
        else:
            print("[INFO] Using text content method for LABEL prompt", flush=True)
            return self._generate_with_text_content(guideline_content, model, instruction_prompt)

        # Xử lý response chung
        return self._process_response(response, guideline_content)
    
    def _generate_with_text_content(self, guideline_content: str, model, instruction_prompt: str) -> str:
        """
        Fallback method sử dụng text content thay vì File API
        """
        # Kiểm tra và cắt guideline nếu quá dài (cho text content method)
        # Với File API, không cần cắt vì Gemini xử lý được file lớn
        max_guideline_length = 50000  # Tăng lên để xử lý guideline 60k tokens
        if len(guideline_content) > max_guideline_length:
            print(f"[WARNING] Guideline very long ({len(guideline_content)} chars), truncating to {max_guideline_length}", flush=True)
            print("[INFO] Consider using File API (upload PDF/DOCX) for better handling of large guidelines", flush=True)
            truncated_guideline = guideline_content[:max_guideline_length] + "\n\n[... Guideline đã bị cắt do quá dài. Khuyến nghị sử dụng file PDF/DOCX thay vì text để xử lý guideline dài ...]"
        else:
            truncated_guideline = guideline_content
        
        # Tạo prompt với text content
        meta_prompt = f"""
{instruction_prompt}

Đây là nội dung guideline:
---
{truncated_guideline}
---
"""
        
        print(f"[DEBUG] Text content length: {len(guideline_content)} characters", flush=True)
        print(f"[DEBUG] Meta prompt length: {len(meta_prompt)} characters", flush=True)
        
        # Estimate tokens (rough: 1 token ≈ 4 characters for Vietnamese)
        estimated_tokens = len(meta_prompt) // 4
        print(f"[DEBUG] Estimated tokens: ~{estimated_tokens} (guideline: ~{len(guideline_content)//4})", flush=True)
        
        if estimated_tokens > 30000:
            print("[WARNING] Very large prompt! Consider using File API for better performance", flush=True)
        
        # Gọi Gemini
        try:
            response = model.generate_content(
                meta_prompt,
                generation_config={
                    'temperature': 0.5,
                    'max_output_tokens': 8192,  # Tăng lên max để xử lý guideline dài (60k tokens)
                }
            )
            return self._process_response(response, guideline_content)
        except Exception as e:
            print(f"[ERROR] Text content method failed: {str(e)}", flush=True)
            return self._create_fallback_prompt(guideline_content)
    
    def _process_response(self, response, guideline_content: str) -> str:
        """
        Xử lý response từ Gemini (chung cho cả File API và text content)
        """
        try:
            print(f"[DEBUG] Response received", flush=True)
            
            # Kiểm tra response structure
            if not response.candidates:
                print("[ERROR] No candidates in response", flush=True)
                return self._create_fallback_prompt(guideline_content)
            
            candidate = response.candidates[0]
            print(f"[DEBUG] Candidate finish reason: {candidate.finish_reason.name}", flush=True)
            
            # Kiểm tra finish_reason
            if candidate.finish_reason.name == "SAFETY":
                print("[ERROR] Blocked by safety filter", flush=True)
                return self._create_fallback_prompt(guideline_content)
            
            if candidate.finish_reason.name == "MAX_TOKENS":
                print("[WARNING] Response truncated due to max tokens - prompt may be incomplete!", flush=True)
                print("[WARNING] Consider increasing max_output_tokens or shortening guideline", flush=True)
            
            # Kiểm tra content
            if not candidate.content or not candidate.content.parts:
                print("[ERROR] No content in response", flush=True)
                return self._create_fallback_prompt(guideline_content)
            
            generated_prompt = candidate.content.parts[0].text.strip()
            print(f"[DEBUG] Generated prompt length: {len(generated_prompt)} characters", flush=True)
            
            # Kiểm tra xem prompt có bị cắt không
            if self._is_prompt_truncated(generated_prompt):
                print("[WARNING] Generated prompt appears to be truncated!", flush=True)
                print("[INFO] Prompt ends with:", generated_prompt[-100:], flush=True)
            
            if not generated_prompt:
                print("[WARNING] Generated prompt is empty, using fallback", flush=True)
                return self._create_fallback_prompt(guideline_content)
            
            return generated_prompt
            
        except Exception as e:
            print(f"[ERROR] Response processing failed: {str(e)}", flush=True)
            return self._create_fallback_prompt(guideline_content)
    
    def _create_fallback_prompt(self, guideline_content: str) -> str:
        """
        Tạo prompt mặc định khi Gemini fail
        """
        # Tăng giới hạn cho fallback prompt
        max_fallback_length = 10000
        truncated_content = guideline_content[:max_fallback_length] if len(guideline_content) > max_fallback_length else guideline_content
        
        return f"""
Bạn là một chuyên gia kiểm tra chất lượng data labeling. Nhiệm vụ của bạn là đánh giá độ chính xác và chất lượng của các nhãn đã được gán cho dữ liệu.

GUIDELINE THAM KHẢO:
{truncated_content}
{f"[... Guideline đã bị cắt từ {len(guideline_content)} xuống {max_fallback_length} ký tự ...]" if len(guideline_content) > max_fallback_length else ""}

NHIỆM VỤ:
1. Kiểm tra tính chính xác của nhãn đã gán
2. Đánh giá chất lượng annotation theo guideline
3. Phát hiện các lỗi thường gặp như: nhãn sai, thiếu nhãn, không nhất quán
4. Đưa ra gợi ý cải thiện nếu cần

OUTPUT FORMAT (JSON):
{{
    "is_correct": true/false,
    "errors": ["lỗi 1", "lỗi 2", ...],
    "suggestions": ["gợi ý 1", "gợi ý 2", ...],
    "confidence_score": 0-100,
    "explanation": "Giải thích chi tiết về đánh giá"
}}

Hãy phân tích dữ liệu được cung cấp và trả về kết quả theo format JSON trên.
"""

    def analyze_guideline_to_rules(self,
                                   guideline_content: str,
                                   api_key: str,
                                   model_name: str = 'gemini-2.5-flash',
                                   guideline_file_path: str = None) -> Dict[str, Any]:
        """Phân tích guideline thành bộ quy tắc (rules) có cấu trúc để tái sử dụng.

        Hàm này mang tính tổng quát, có thể áp dụng cho nhiều loại guideline khác nhau
        (classification, tagging, OCR, sentiment...).

        Returns:
            Dict có dạng tối thiểu: {"rules": [...]}.
        """
        if genai is None:
            raise ImportError("Cần cài đặt google-generativeai: pip install google-generativeai")

        # Cấu hình Gemini
        genai.configure(api_key=api_key)

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

        model = genai.GenerativeModel(
            model_name=model_name,
            safety_settings=safety_settings
        )

        schema_description = """
Hãy đọc kỹ guideline và trích xuất thành một danh sách các quy tắc (rules) có cấu trúc.
Trả về DUY NHẤT một JSON với format:
{
  "rules": [
    {
      "id": "R_UNIQUE_ID_01",                // chuỗi ID ngắn, duy nhất trong phạm vi guideline
      "title": "Tiêu đề ngắn mô tả quy tắc",  // 1 câu ngắn
      "description": "Mô tả chi tiết quy tắc và trường hợp áp dụng",
      "applies_to_fields": ["tên_cột_1", "tên_cột_2", ...],
      "conditions": "Điều kiện áp dụng dưới dạng text tự nhiên (nếu có)",
      "severity": "error|warning|info",       // mức độ vi phạm
      "examples_correct": ["ví dụ đúng 1", "ví dụ đúng 2"],
      "examples_incorrect": ["ví dụ sai 1", "ví dụ sai 2"],
      "source_quote": "Trích nguyên văn (hoặc gần nguyên văn) đoạn guideline dùng để suy ra rule này"
    }
  ]
}

YÊU CẦU QUAN TRỌNG:
- Tuyệt đối KHÔNG bịa quy tắc không xuất phát từ guideline.
- Mỗi rule phải có "source_quote" để có thể kiểm tra lại.
- Nếu guideline mơ hồ/không đủ thông tin, hãy phản ánh đúng mức độ mơ hồ trong "description".
- Không thêm bất kỳ text nào ngoài JSON (không markdown, không giải thích bên ngoài).
"""

        # Chuẩn bị input cho model
        if guideline_file_path and os.path.exists(guideline_file_path):
            # Ưu tiên dùng File API cho PDF/DOCX dài
            print(f"[INFO] Using File API for guideline rule extraction: {guideline_file_path}", flush=True)
            try:
                uploaded_file = genai.upload_file(
                    path=guideline_file_path,
                    display_name="Guideline Document for Rule Extraction"
                )

                import time
                start_time = time.time()
                max_wait_seconds = 300
                while uploaded_file.state.name == "PROCESSING":
                    if time.time() - start_time > max_wait_seconds:
                        raise TimeoutError("Quá thời gian chờ xử lý guideline cho rule extraction")
                    time.sleep(2)
                    uploaded_file = genai.get_file(uploaded_file.name)

                if uploaded_file.state.name == "FAILED":
                    raise RuntimeError("File guideline ở trạng thái FAILED khi extract rules")

                response = model.generate_content(
                    [uploaded_file, schema_description],
                    generation_config={
                        'temperature': 0.3,
                        'max_output_tokens': 8192,
                    }
                )
            finally:
                try:
                    genai.delete_file(uploaded_file.name)
                except Exception:
                    pass
        else:
            # Dùng text content trực tiếp
            max_guideline_length = 60000
            if len(guideline_content) > max_guideline_length:
                print(f"[WARNING] Guideline too long ({len(guideline_content)} chars), truncating for rule extraction", flush=True)
                truncated = guideline_content[:max_guideline_length]
            else:
                truncated = guideline_content

            meta_prompt = f"""
{schema_description}

Đây là toàn bộ nội dung guideline (đã có thể bị cắt ngắn nếu quá dài):
---
{truncated}
---
"""

            response = model.generate_content(
                meta_prompt,
                generation_config={
                    'temperature': 0.3,
                    'max_output_tokens': 8192,
                }
            )

        # Parse JSON từ response
        try:
            raw_text = getattr(response, 'text', '') or ''
            if not raw_text and getattr(response, 'candidates', None):
                candidate = response.candidates[0]
                if candidate and candidate.content and candidate.content.parts:
                    raw_text = candidate.content.parts[0].text or ''

            raw_text = raw_text.strip()
            if raw_text.startswith('```json'):
                raw_text = raw_text[7:]
            if raw_text.startswith('```'):
                raw_text = raw_text[3:]
            if raw_text.endswith('```'):
                raw_text = raw_text[:-3]

            parsed = json.loads(raw_text)
            if not isinstance(parsed, dict):
                parsed = {"rules": parsed}
            if 'rules' not in parsed or not isinstance(parsed['rules'], list):
                parsed['rules'] = []
            return parsed
        except Exception as e:
            print(f"[ERROR] Failed to parse guideline rules JSON: {str(e)}", flush=True)
            # Trả về cấu trúc tối thiểu để không làm hỏng flow
            return {"rules": []}
    
    def create_qa_prompt(self, data_row: Dict[str, Any], guideline_summary: str, rules=None) -> str:
        """
        Tạo prompt cụ thể cho một dòng data cần QA
        
        Args:
            data_row: Dictionary chứa một dòng data
            guideline_summary: Tóm tắt guideline hoặc prompt đã sinh
            
        Returns:
            Prompt hoàn chỉnh để gửi đến AI
        """
        # Chuyển data row thành format dễ đọc
        data_str = json.dumps(data_row, ensure_ascii=False, indent=2)

        # Nếu có bộ rules đã phân tích thì embed vào prompt để AI bám theo
        rules_section = ""
        if isinstance(rules, dict) and rules.get('rules'):
            try:
                rules_str = json.dumps(rules['rules'], ensure_ascii=False, indent=2)
            except Exception:
                rules_str = str(rules)
            rules_section = f"\nBộ quy tắc (rules) được trích xuất có cấu trúc từ guideline:\n{rules_str}\n"

        prompt = f"""
{guideline_summary}
{rules_section}

Nguyên tắc đánh giá:
- Chỉ sử dụng các quy tắc, định nghĩa và ví dụ được nêu rõ trong guideline hoặc trong danh sách rules ở trên.
- Chỉ đánh giá dựa trên CÁC TRƯỜNG THỰC TẾ có trong object "Dữ liệu cần kiểm tra" bên dưới.
  * Không được yêu cầu hay coi việc thiếu các trường khác (ví dụ: "image_description", "labeled_main_tag",
    "labeled_category" hoặc bất kỳ tên trường nào không xuất hiện trong object đó) là lỗi định dạng.
- KHÔNG được tự suy diễn thêm quy tắc mới nếu guideline/rules không nói tới.
- Nếu guideline/rules không quy định rõ cho trường hợp cụ thể này, hãy ưu tiên không đánh sai:
  * Chỉ đặt "is_correct": false khi có vi phạm RÕ RÀNG với guideline/rules dựa trên các trường thực tế trong dữ liệu.
  * Nếu không tìm thấy quy tắc áp dụng, hãy giữ "is_correct" là true và ghi rõ trong
    "explanation"/"errors" rằng guideline không có quy định rõ cho trường hợp này.
- Khi đánh giá việc sử dụng nhãn "OTHER", chỉ coi đó là lỗi nếu cách dùng "OTHER" trái với
  phần mô tả/định nghĩa về "OTHER" trong guideline. Không được tự thêm quy tắc chung cho
  "OTHER" (ví dụ: bắt buộc các trường cate_x phải null) nếu guideline không ghi rõ.
- Luôn cố gắng đưa ra kết luận rõ ràng, không trả lời chung chung kiểu "Không rõ", "không biết",
  "unable to determine" nếu dữ liệu và guideline cung cấp đủ thông tin.
  * Nếu KHÔNG tìm được bất kỳ rule nào bị vi phạm thì phải ưu tiên coi nhãn hiện tại là đúng
    ("is_correct": true), ngay cả khi có thể tồn tại cách gán nhãn khác cũng hợp lý.
  * Chỉ được gán "is_correct": false nếu bạn chỉ ra được ít nhất một rule cụ thể trong danh sách rules
    (hoặc đoạn guideline tương đương) đang bị vi phạm.
- Khi "is_correct" = false:
  * BẮT BUỘC phải cung cấp trường "violated_rules": danh sách các id rule (ví dụ: ["R_MAIN_TAG_01"]).
  * Mỗi lỗi trong "errors" phải gắn với ít nhất một rule trong "violated_rules".
- Khi "is_correct" = true:
  * "violated_rules" phải tồn tại và là list rỗng [].

Dữ liệu cần kiểm tra:
{data_str}

Hãy phân tích dữ liệu trên theo guideline và trả về kết quả dưới dạng JSON với format:
{{
    "is_correct": true/false,
    "errors": ["lỗi 1", "lỗi 2", ...],
    "suggestions": ["gợi ý 1", "gợi ý 2", ...],
    "violated_rules": ["RULE_ID_01", "RULE_ID_02"],
    "confidence_score": 0-100,
    "explanation": "Giải thích chi tiết"
}}

Chỉ trả về JSON, không thêm text khác.
"""
        
        return prompt

    def create_qa_batch_prompt(
        self,
        data_rows: List[Dict[str, Any]],
        guideline_summary: str,
        rules=None,
    ) -> str:
        """Tạo prompt batch cho nhiều dòng QA trong 1 request (TEXT-ONLY).

        Output mong muốn:
        {
          "items": [
            {
              "index": 0,
              "is_correct": true/false,
              "errors": [...],
              "suggestions": [...],
              "violated_rules": [...],
              "confidence_score": 0-100,
              "explanation": "..."
            },
            ...
          ]
        }
        """

        items = []
        for idx, row in enumerate(data_rows):
            items.append({"index": idx, "data": row})

        data_str = json.dumps(items, ensure_ascii=False, indent=2)

        rules_section = ""
        if isinstance(rules, dict) and rules.get('rules'):
            try:
                rules_str = json.dumps(rules['rules'], ensure_ascii=False, indent=2)
            except Exception:
                rules_str = str(rules)
            rules_section = f"\nBộ quy tắc (rules) được trích xuất có cấu trúc từ guideline:\n{rules_str}\n"

        prompt = f"""
{guideline_summary}
{rules_section}

Bạn sẽ đánh giá MỘT DANH SÁCH nhiều dòng dữ liệu trong MỘT LẦN gọi.

Danh sách dữ liệu cần kiểm tra (mỗi phần tử có trường "index" để nhận dạng dòng trong batch):
{data_str}

Nguyên tắc đánh giá giống như create_qa_prompt cho từng dòng, nhưng lần này:
- PHẢI đánh giá TỪNG PHẦN TỬ TRONG DANH SÁCH, KHÔNG được gộp hoặc bỏ sót bất kỳ phần tử nào.
- Với mỗi phần tử, hãy trả về một object kết quả theo format:
  {{
    "index": <giá trị index của phần tử>,
    "is_correct": true/false,
    "errors": ["lỗi 1", "lỗi 2", ...],
    "suggestions": ["gợi ý 1", "gợi ý 2", ...],
    "violated_rules": ["RULE_ID_01", "RULE_ID_02"],
    "confidence_score": 0-100,
    "explanation": "Giải thích chi tiết"
  }}

TRẢ VỀ DUY NHẤT một JSON với format:
{{
  "items": [
    {{
      "index": 0,
      "is_correct": true/false,
      "errors": ["..."],
      "suggestions": ["..."],
      "violated_rules": ["..."],
      "confidence_score": 0-100,
      "explanation": "..."
    }},
    {{
      "index": 1,
      "is_correct": true/false,
      "errors": ["..."],
      "suggestions": ["..."],
      "violated_rules": ["..."],
      "confidence_score": 0-100,
      "explanation": "..."
    }},
    ...
  ]
}}

Không thêm bất kỳ text nào ngoài JSON.
"""

        return prompt
    
    def create_label_prompt(
        self,
        data_row: Dict[str, Any],
        guideline_summary: str,
        rules=None,
        output_fields=None,
    ) -> str:
        """Tạo prompt cụ thể cho một dòng data cần GÁN LABEL (không kiểm tra is_correct).

        Output mong muốn (per row):
        {
          "labels": { ... },
          "explanation": "...",
          "errors": ["..."]
        }
        """
        data_str = json.dumps(data_row, ensure_ascii=False, indent=2)

        rules_section = ""
        if isinstance(rules, dict) and rules.get('rules'):
            try:
                rules_str = json.dumps(rules['rules'], ensure_ascii=False, indent=2)
            except Exception:
                rules_str = str(rules)
            rules_section = f"\nBộ quy tắc (rules) được trích xuất có cấu trúc từ guideline:\n{rules_str}\n"

        # Mô tả các key output động trong labels
        fields = []
        if isinstance(output_fields, list):
            for f in output_fields:
                if isinstance(f, dict) and f.get('key'):
                    desc = f.get('description') or ''
                    fields.append(f"- {f['key']}: {desc}")

        if not fields:
            # Fallback mặc định nếu chưa cấu hình
            fields = [
                "- tag: Tag chính (ví dụ: identity, document, other)",
                "- cate1: Loại/nhóm chính (ví dụ: căn cước công dân, CMND, hộ chiếu)",
            ]

        fields_text = "\n".join(fields)

        prompt = f"""
{guideline_summary}
{rules_section}

Các key output mong muốn trong object "labels":
{fields_text}

Dữ liệu cần gán label:
{data_str}

Nhiệm vụ của bạn:
- Đọc kỹ guideline/rules ở trên.
- GÁN CÁC LABEL PHÙ HỢP cho dòng dữ liệu này, sử dụng CHÍNH XÁC các key trong danh sách trên.
- Nếu dữ liệu/ảnh thể hiện một loại giấy tờ định danh như CCCD, CMND, hộ chiếu..., hãy gán
  các label tương ứng (ví dụ: tag = "identity", cate1 = "căn cước công dân").

Nguyên tắc:
- Chỉ chọn các label được guideline cho phép.
- Nếu không chắc chắn, có thể chọn nhãn "OTHER" (nếu guideline có) và giải thích sự mơ hồ.
- Không trả lời chung chung kiểu "không rõ" nếu guideline và dữ liệu đủ thông tin.

Trả về kết quả DUY NHẤT dưới dạng JSON:
{{
  "labels": {{
    "<các key ở trên>": "..."
  }},
  "explanation": "Giải thích ngắn gọn, nêu rõ vì sao bạn chọn các label trên",
  "errors": ["lỗi 1 nếu có (ví dụ: dữ liệu không đủ, guideline mơ hồ)"]
}}

Chỉ trả về JSON, không thêm text khác.
"""

        return prompt

    def create_label_batch_prompt(
        self,
        data_rows: List[Dict[str, Any]],
        guideline_summary: str,
        rules=None,
        output_fields=None,
    ) -> str:
        """Tạo prompt batch cho nhiều dòng LABELING (text-only) trong 1 request.

        Output mong muốn:
        {
          "items": [
            {
              "index": 0,
              "labels": { ... },
              "explanation": "...",
              "errors": ["..."]
            },
            ...
          ]
        }
        """

        items = []
        for idx, row in enumerate(data_rows):
            items.append({"index": idx, "data": row})

        data_str = json.dumps(items, ensure_ascii=False, indent=2)

        rules_section = ""
        if isinstance(rules, dict) and rules.get('rules'):
            try:
                rules_str = json.dumps(rules['rules'], ensure_ascii=False, indent=2)
            except Exception:
                rules_str = str(rules)
            rules_section = f"\nBộ quy tắc (rules) được trích xuất có cấu trúc từ guideline:\n{rules_str}\n"

        # Mô tả các key output động trong labels (giống create_label_prompt)
        fields: List[str] = []
        if isinstance(output_fields, list):
            for f in output_fields:
                if isinstance(f, dict) and f.get('key'):
                    desc = f.get('description') or ''
                    fields.append(f"- {f['key']}: {desc}")

        if not fields:
            fields = [
                "- tag: Tag chính (ví dụ: identity, document, other)",
                "- cate1: Loại/nhóm chính (ví dụ: căn cước công dân, CMND, hộ chiếu)",
            ]

        fields_text = "\n".join(fields)

        prompt = f"""
{guideline_summary}
{rules_section}

Các key output mong muốn trong object "labels":
{fields_text}

Bạn sẽ gán LABEL cho MỘT DANH SÁCH nhiều dòng dữ liệu trong MỘT LẦN gọi.

Danh sách dữ liệu cần gán label (mỗi phần tử có trường "index" để nhận dạng dòng trong batch):
{data_str}

Nguyên tắc:
- Áp dụng giống như create_label_prompt cho từng dòng đơn lẻ.
- PHẢI xử lý TỪNG PHẦN TỬ trong danh sách, không được bỏ sót.
- Với mỗi phần tử, trả về một object kết quả theo format:
  {{
    "index": <giá trị index của phần tử>,
    "labels": {{ "<các key ở trên>": "..." }},
    "explanation": "Giải thích ngắn gọn",
    "errors": ["lỗi 1 nếu có"]
  }}

TRẢ VỀ DUY NHẤT một JSON với format:
{{
  "items": [
    {{
      "index": 0,
      "labels": {{ "...": "..." }},
      "explanation": "...",
      "errors": ["..."]
    }},
    {{
      "index": 1,
      "labels": {{ "...": "..." }},
      "explanation": "...",
      "errors": ["..."]
    }},
    ...
  ]
}}

Không thêm bất kỳ text nào ngoài JSON.
"""

        return prompt

    def create_media_label_prompt(
        self,
        data_row: Dict[str, Any],
        media_type: str,
        guideline_summary: str,
        rules=None,
        output_fields=None,
    ) -> str:
        """Tạo prompt cho LABELING với media (image, audio, video)."""
        data_str = json.dumps(data_row, ensure_ascii=False, indent=2)

        media_instructions = {
            'image': 'Phân tích nội dung hình ảnh (đối tượng chính, loại giấy tờ, bối cảnh) và gán label phù hợp.',
            'audio': 'Phân tích nội dung audio và gán các label theo guideline.',
            'video': 'Phân tích nội dung video (các khung hình quan trọng, nội dung chính) và gán label theo guideline.',
        }

        instruction = media_instructions.get(
            media_type,
            'Phân tích nội dung media và gán label phù hợp theo guideline.',
        )

        rules_section = ""
        if isinstance(rules, dict) and rules.get('rules'):
            try:
                rules_str = json.dumps(rules['rules'], ensure_ascii=False, indent=2)
            except Exception:
                rules_str = str(rules)
            rules_section = f"\nBộ quy tắc (rules) được trích xuất có cấu trúc từ guideline:\n{rules_str}\n"

        fields = []
        if isinstance(output_fields, list):
            for f in output_fields:
                if isinstance(f, dict) and f.get('key'):
                    desc = f.get('description') or ''
                    fields.append(f"- {f['key']}: {desc}")

        if not fields:
            fields = [
                "- tag: Tag chính (ví dụ: identity, document, other)",
                "- cate1: Loại/nhóm chính (ví dụ: căn cước công dân, CMND, hộ chiếu)",
            ]

        fields_text = "\n".join(fields)

        prompt = f"""
{guideline_summary}
{rules_section}

Các key output mong muốn trong object "labels":
{fields_text}

Dữ liệu cần gán label (text):
{data_str}

Media đính kèm: {media_type}

Nhiệm vụ của bạn:
1. {instruction}
2. Kết hợp cả dữ liệu text và nội dung media để gán các label phù hợp, sử dụng CHÍNH XÁC các key trong danh sách trên.
3. Bám sát định nghĩa nhãn trong guideline (ví dụ: phân biệt rõ identity vs. other_document, CCCD vs. CMND...).

Trả về kết quả DUY NHẤT dưới dạng JSON:
{{
  "labels": {{
    "<các key ở trên>": "..."
  }},
  "explanation": "Giải thích ngắn gọn cách bạn sử dụng thông tin từ media + text để gán label",
  "errors": ["lỗi 1 nếu có"]
}}

Chỉ trả về JSON, không thêm text khác.
"""

        return prompt
    
    def create_verification_prompt(self, 
                                   data_row: Dict[str, Any], 
                                   original_result: Dict[str, Any],
                                   guideline_summary: str) -> str:
        """
        Tạo prompt cho việc đối chiếu (verification)
        
        Args:
            data_row: Dòng data gốc
            original_result: Kết quả QA ban đầu
            guideline_summary: Tóm tắt guideline
            
        Returns:
            Prompt cho verification
        """
        data_str = json.dumps(data_row, ensure_ascii=False, indent=2)
        result_str = json.dumps(original_result, ensure_ascii=False, indent=2)
        
        prompt = f"""
{guideline_summary}

Dữ liệu gốc:
{data_str}

Kết quả đánh giá trước đó (từ một AI QA khác):
{result_str}

Nguyên tắc đánh giá cho verifier:
- Bạn phải ĐÁNH GIÁ LẠI dữ liệu theo guideline một cách độc lập, không bị lệ thuộc vào kết quả trước đó.
- Chỉ sử dụng các quy tắc, định nghĩa và ví dụ được nêu rõ trong guideline (và bất kỳ rules có cấu trúc nào nếu đã được embed trong guideline_summary).
- KHÔNG được tự suy diễn thêm quy tắc mới nếu guideline không nói tới.
- Chỉ được gán "is_correct": false cho dữ liệu nếu bạn chỉ ra được ít nhất một quy tắc trong guideline bị vi phạm rõ ràng.
- Nếu không tìm thấy quy tắc nào bị vi phạm, hãy ưu tiên coi nhãn hiện tại là đúng ("is_correct": true), ngay cả khi có thể tồn tại cách gán nhãn khác cũng hợp lý.
- Luôn cố gắng đưa ra kết luận rõ ràng, không trả lời chung chung kiểu "Không rõ", "không biết", "unable to determine" nếu dữ liệu và guideline cung cấp đủ thông tin.
- Khi "is_correct" = false:
  * BẮT BUỘC phải cung cấp trường "violated_rules": danh sách các id rule (ví dụ: ["R_MAIN_TAG_01"]).
  * Mỗi lỗi trong "errors" phải gắn với ít nhất một rule trong "violated_rules".
- Khi "is_correct" = true:
  * "violated_rules" phải tồn tại và là list rỗng [].

Nhiệm vụ của bạn:
1. Đánh giá lại dữ liệu theo guideline một cách độc lập (giống như một QA mới).
2. So sánh với kết quả đánh giá trước đó và cho biết bạn CÓ đồng ý với đánh giá đó hay không.
3. Nếu không đồng ý, hãy giải thích rõ sự khác biệt và rule nào khiến bạn đưa ra đánh giá khác.

Trả về kết quả dưới dạng JSON:
{{
    "is_correct": true/false,
    "errors": ["lỗi 1", "lỗi 2", ...],
    "suggestions": ["gợi ý 1", "gợi ý 2", ...],
    "violated_rules": ["RULE_ID_01", "RULE_ID_02"],
    "confidence_score": 0-100,
    "explanation": "Giải thích chi tiết về đánh giá của bạn (dựa trên guideline và các rule cụ thể)",
    "agreement_with_previous": true/false,
    "differences": ["khác biệt 1", "khác biệt 2", ...]
}}

Chỉ trả về JSON, không thêm text khác.
"""
        
        return prompt
    
    def create_media_qa_prompt(self, 
                              data_row: Dict[str, Any],
                              media_type: str,
                              guideline_summary: str,
                              rules=None) -> str:
        """
        Tạo prompt cho QA với media (image, audio, video)
        
        Args:
            data_row: Dòng data
            media_type: Loại media
            guideline_summary: Tóm tắt guideline
            
        Returns:
            Prompt cho media QA
        """
        data_str = json.dumps(data_row, ensure_ascii=False, indent=2)

        media_instructions = {
            'image': 'Phân tích nội dung hình ảnh và xem đối tượng/chủ thể chính là gì, đối chiếu với các nhãn và quy tắc trong guideline.',
            'audio': 'Phân tích nội dung audio và so sánh với thông tin trong data theo đúng quy tắc trong guideline.',
            'video': 'Phân tích nội dung video (khung hình chính, nội dung chính) và so sánh với thông tin trong data theo đúng quy tắc trong guideline.'
        }

        instruction = media_instructions.get(media_type, 'Phân tích media và đối chiếu với dữ liệu theo guideline.')

        rules_section = ""
        if isinstance(rules, dict) and rules.get('rules'):
            try:
                rules_str = json.dumps(rules['rules'], ensure_ascii=False, indent=2)
            except Exception:
                rules_str = str(rules)
            rules_section = f"\nBộ quy tắc (rules) được trích xuất có cấu trúc từ guideline:\n{rules_str}\n"

        prompt = f"""
{guideline_summary}
{rules_section}

Dữ liệu cần kiểm tra:
{data_str}

Media đính kèm: {media_type}

Nguyên tắc đánh giá:
- Chỉ sử dụng các quy tắc, định nghĩa và ví dụ được nêu rõ trong guideline hoặc trong danh sách rules ở trên.
- Chỉ đánh giá dựa trên CÁC TRƯỜNG THỰC TẾ có trong object "Dữ liệu cần kiểm tra" và nội dung thực tế của media.
  * Không được yêu cầu hay coi việc thiếu các trường khác (không có trong object data) là lỗi.
- KHÔNG được tự suy diễn thêm quy tắc mới nếu guideline/rules không nói tới.
- Nếu guideline/rules không quy định rõ cho trường hợp cụ thể này, hãy ưu tiên không đánh sai:
  * Chỉ đặt "is_correct": false khi có vi phạm RÕ RÀNG với guideline/rules dựa trên dữ liệu + media.
  * Nếu không tìm thấy quy tắc áp dụng, hãy giữ "is_correct" là true và ghi rõ trong
    "explanation"/"errors" rằng guideline không có quy định rõ cho trường hợp này.
- Khi đánh giá việc sử dụng nhãn "OTHER", chỉ coi đó là lỗi nếu cách dùng "OTHER" trái với
  phần mô tả/định nghĩa về "OTHER" trong guideline. Không được tự thêm quy tắc chung cho
  "OTHER" nếu guideline không ghi rõ.
- Luôn cố gắng đưa ra kết luận rõ ràng, không trả lời chung chung kiểu "Không rõ", "không biết",
  "unable to determine" nếu dữ liệu và guideline cung cấp đủ thông tin.
  * Nếu KHÔNG tìm được bất kỳ rule nào bị vi phạm thì phải ưu tiên coi nhãn hiện tại là đúng
    ("is_correct": true), ngay cả khi có thể tồn tại cách gán nhãn khác cũng hợp lý.
  * Chỉ được gán "is_correct": false nếu bạn chỉ ra được ít nhất một rule cụ thể trong danh sách rules
    (hoặc đoạn guideline tương đương) đang bị vi phạm.
- Khi "is_correct" = false:
  * BẮT BUỘC phải cung cấp trường "violated_rules": danh sách các id rule (ví dụ: ["R_MAIN_TAG_01"]).
  * Mỗi lỗi trong "errors" phải gắn với ít nhất một rule trong "violated_rules".
- Khi "is_correct" = true:
  * "violated_rules" phải tồn tại và là list rỗng [].

Nhiệm vụ:
1. {instruction}
2. Kiểm tra tính nhất quán giữa media và data theo đúng guideline và rules.
3. Đánh giá chất lượng labeling theo guideline, chỉ chấm sai khi chỉ ra được rule bị vi phạm.

Trả về kết quả dưới dạng JSON:
{{
    "is_correct": true/false,
    "errors": ["lỗi 1", "lỗi 2", ...],
    "suggestions": ["gợi ý 1", "gợi ý 2", ...],
    "violated_rules": ["RULE_ID_01", "RULE_ID_02"],
    "confidence_score": 0-100,
    "explanation": "Giải thích chi tiết",
    "media_analysis": "Phân tích chi tiết về media và mối liên hệ với dữ liệu"
}}

Chỉ trả về JSON, không thêm text khác.
"""
        
        return prompt
    
    def validate_prompt(self, prompt: str) -> Dict[str, Any]:
        """
        Kiểm tra prompt có hợp lệ không
        
        Args:
            prompt: Prompt cần kiểm tra
            
        Returns:
            Dictionary chứa kết quả validation
        """
        issues = []
        
        # Kiểm tra độ dài
        if len(prompt) < 100:
            issues.append("Prompt quá ngắn, có thể thiếu thông tin")
        
        if len(prompt) > 10000:
            issues.append("Prompt quá dài, có thể gây tốn token")
        
        # Kiểm tra có yêu cầu format JSON không
        if 'json' not in prompt.lower():
            issues.append("Prompt nên yêu cầu output dạng JSON để dễ parse")
        
        # Kiểm tra có guideline không
        if 'guideline' not in prompt.lower() and 'tiêu chí' not in prompt.lower():
            issues.append("Prompt nên đề cập đến guideline hoặc tiêu chí đánh giá")
        
        return {
            'is_valid': len(issues) == 0,
            'issues': issues,
            'length': len(prompt)
        }
    
    def _is_prompt_truncated(self, prompt: str) -> bool:
        """
        Kiểm tra xem prompt có bị cắt không dựa trên các dấu hiệu
        
        Args:
            prompt: Prompt cần kiểm tra
            
        Returns:
            True nếu prompt có vẻ bị cắt
        """
        # Các dấu hiệu prompt bị cắt
        truncation_indicators = [
            # Kết thúc giữa chừng
            prompt.endswith('Bước 3: Gắn Ph'),
            prompt.endswith('Bước 3:'),
            prompt.endswith('3:'),
            # Kết thúc không hoàn chỉnh
            not prompt.endswith('}') and 'json' in prompt.lower(),
            not prompt.endswith('.') and not prompt.endswith('}') and not prompt.endswith('"'),
            # Kết thúc với từ không hoàn chỉnh
            len(prompt) > 100 and prompt[-20:].count(' ') < 2,
        ]
        
        return any(truncation_indicators)
