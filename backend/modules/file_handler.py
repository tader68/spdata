"""
Module xử lý file: Upload, Parse, Extract content
Hỗ trợ Excel, PDF, Word, TXT và các file media
"""

import os
import uuid
import pandas as pd
from datetime import datetime
from werkzeug.utils import secure_filename
import json
import mimetypes
from typing import Dict, Any

# Import thư viện xử lý file
try:
    from PyPDF2 import PdfReader
except ImportError:
    PdfReader = None

try:
    from docx import Document
except ImportError:
    Document = None

class FileHandler:
    """
    Class xử lý tất cả các thao tác liên quan đến file
    """
    
    def __init__(self, upload_folder):
        """
        Khởi tạo FileHandler
        
        Args:
            upload_folder: Thư mục lưu trữ file upload
        """
        self.upload_folder = upload_folder
        self.data_folder = os.path.join(upload_folder, 'data')
        self.guideline_folder = os.path.join(upload_folder, 'guidelines')
        self.media_folder = os.path.join(upload_folder, 'media')
        self.metadata_folder = os.path.join(upload_folder, 'metadata')
        
        # Tạo các thư mục nếu chưa tồn tại
        for folder in [self.data_folder, self.guideline_folder, 
                       self.media_folder, self.metadata_folder]:
            os.makedirs(folder, exist_ok=True)
        
        # Định nghĩa các extension được phép
        self.allowed_data_extensions = {'.xlsx', '.xls', '.csv'}
        self.allowed_guideline_extensions = {'.pdf', '.xlsx', '.xls', '.docx', '.doc', '.txt'}
        self.allowed_media_extensions = {
            # Audio
            '.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg',
            # Image
            '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg',
            # Video
            '.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm'
        }
    
    def _get_file_extension(self, filename):
        """
        Lấy extension của file
        
        Args:
            filename: Tên file
            
        Returns:
            Extension của file (lowercase)
        """
        return os.path.splitext(filename)[1].lower()
    
    def _generate_file_id(self):
        """
        Sinh ID unique cho file
        
        Returns:
            UUID string
        """
        return str(uuid.uuid4())
    
    def save_uploaded_file(self, file, file_type):
        """
        Lưu file được upload
        
        Args:
            file: File object từ request
            file_type: Loại file ('data', 'guideline', 'media')
            
        Returns:
            Đường dẫn đến file đã lưu
        """
        filename = secure_filename(file.filename)
        file_id = self._generate_file_id()
        extension = self._get_file_extension(filename)
        
        # Chọn thư mục phù hợp
        if file_type == 'data':
            folder = self.data_folder
            allowed = self.allowed_data_extensions
        elif file_type == 'guideline':
            folder = self.guideline_folder
            allowed = self.allowed_guideline_extensions
        else:
            folder = self.media_folder
            allowed = self.allowed_media_extensions
        
        # Kiểm tra extension
        if extension not in allowed:
            raise ValueError(f"File extension {extension} không được hỗ trợ cho {file_type}")
        
        # Tạo tên file mới với ID
        new_filename = f"{file_id}_{filename}"
        file_path = os.path.join(folder, new_filename)
        
        # Lưu file
        file.save(file_path)
        
        # Lưu metadata
        self._save_metadata(file_id, {
            'original_filename': filename,
            'file_path': file_path,
            'file_type': file_type,
            'extension': extension,
            'upload_time': datetime.now().isoformat(),
            'size': os.path.getsize(file_path)
        })
        
        return file_path
    
    def _save_metadata(self, file_id, metadata):
        """
        Lưu metadata của file
        
        Args:
            file_id: ID của file
            metadata: Dictionary chứa metadata
        """
        metadata_path = os.path.join(self.metadata_folder, f"{file_id}.json")
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)
    
    def _load_metadata(self, file_id):
        """
        Load metadata của file
        
        Args:
            file_id: ID của file
            
        Returns:
            Dictionary chứa metadata
        """
        metadata_path = os.path.join(self.metadata_folder, f"{file_id}.json")
        if not os.path.exists(metadata_path):
            raise FileNotFoundError(f"Không tìm thấy metadata cho file {file_id}")
        
        with open(metadata_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def parse_excel(self, file_path):
        """
        Parse file Excel và trích xuất thông tin
        
        Args:
            file_path: Đường dẫn đến file Excel
            
        Returns:
            Dictionary chứa thông tin data
        """
        # Đọc Excel - thử nhiều cách
        df = None
        try:
            # Cách 1: Đọc bình thường
            df = pd.read_excel(file_path, sheet_name=0)
            print(f"[DEBUG] Đọc cách 1: {len(df)} rows, {len(df.columns)} columns")
            
            # Nếu không có cột hoặc cột là Unnamed, thử đọc lại với header khác
            if len(df.columns) == 0 or all('Unnamed' in str(col) for col in df.columns):
                print("[DEBUG] Thử đọc với header=None")
                df = pd.read_excel(file_path, sheet_name=0, header=None)
                print(f"[DEBUG] Đọc cách 2: {len(df)} rows, {len(df.columns)} columns")
            
            # Nếu vẫn rỗng, thử các sheet khác
            if df.empty or len(df.columns) == 0:
                print("[DEBUG] Sheet đầu rỗng, thử sheet khác...")
                excel_file = pd.ExcelFile(file_path)
                sheet_names = excel_file.sheet_names
                print(f"[DEBUG] Có {len(sheet_names)} sheets: {sheet_names}")
                
                for sheet_name in sheet_names:
                    df = pd.read_excel(file_path, sheet_name=sheet_name)
                    print(f"[DEBUG] Sheet '{sheet_name}': {len(df)} rows, {len(df.columns)} columns")
                    if not df.empty and len(df.columns) > 0:
                        print(f"[INFO] Sử dụng sheet: {sheet_name}")
                        break
            
            # Kiểm tra cuối cùng
            if df is None or df.empty or len(df.columns) == 0:
                raise ValueError("File Excel không có dữ liệu hoặc không có cột")
            
        except Exception as e:
            print(f"[ERROR] Lỗi khi đọc Excel: {str(e)}")
            import traceback
            traceback.print_exc()
            raise ValueError(f"Không thể đọc file Excel: {str(e)}")
        
        # Convert datetime columns sang string để tránh lỗi JSON serialization
        for col in df.columns:
            if pd.api.types.is_datetime64_any_dtype(df[col]):
                df[col] = df[col].astype(str)
        
        # Replace tất cả NaN/NA/NaT với None để tránh lỗi JSON parse
        import numpy as np
        df = df.replace([np.nan, np.inf, -np.inf], None)
        df = df.where(pd.notna(df), None)
        
        # Lấy file_id từ tên file
        filename = os.path.basename(file_path)
        file_id = filename.split('_')[0]
        
        # Log thông tin
        print(f"Parsed Excel: {len(df)} rows, {len(df.columns)} columns")
        print(f"Columns: {list(df.columns)}")
        
        # Chuẩn bị thông tin
        data_info = {
            'file_id': file_id,
            'rows': int(len(df)),
            'columns': [str(col) for col in df.columns],
            'preview': df.head(5).to_dict('records'),
            'has_media_column': self._check_media_column(df)
        }
        
        # Lưu data đầy đủ
        data_path = os.path.join(self.metadata_folder, f"{file_id}_data.json")
        df.to_json(data_path, orient='records', force_ascii=False, indent=2, date_format='iso')
        
        # Update metadata
        metadata = self._load_metadata(file_id)
        metadata.update(data_info)
        self._save_metadata(file_id, metadata)
        
        return data_info
    
    def _check_media_column(self, df):
        """
        Kiểm tra xem DataFrame có cột media không
        
        Args:
            df: pandas DataFrame
            
        Returns:
            Boolean và tên cột media nếu có
        """
        media_keywords = ['media', 'file', 'filename', 'audio', 'image', 'video']
        for col in df.columns:
            if any(keyword in col.lower() for keyword in media_keywords):
                return {'has_media': True, 'column_name': col}
        return {'has_media': False, 'column_name': None}
    
    def extract_guideline_content(self, file_path):
        """
        Trích xuất nội dung từ file guideline
        
        Args:
            file_path: Đường dẫn đến file guideline
            
        Returns:
            Dictionary chứa nội dung guideline
        """
        extension = self._get_file_extension(file_path)
        filename = os.path.basename(file_path)
        file_id = filename.split('_')[0]
        
        content = ""
        
        # Xử lý theo từng loại file
        if extension == '.txt':
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        
        elif extension == '.pdf':
            if PdfReader is None:
                raise ImportError("Cần cài đặt PyPDF2: pip install PyPDF2")
            reader = PdfReader(file_path)
            content = "\n".join([page.extract_text() for page in reader.pages])
        
        elif extension in ['.docx', '.doc']:
            if Document is None:
                raise ImportError("Cần cài đặt python-docx: pip install python-docx")
            doc = Document(file_path)
            content = "\n".join([para.text for para in doc.paragraphs])
        
        elif extension in ['.xlsx', '.xls']:
            df = pd.read_excel(file_path)
            content = df.to_string()
        
        # Lưu content
        content_path = os.path.join(self.metadata_folder, f"{file_id}_content.txt")
        with open(content_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        # Update metadata
        metadata = self._load_metadata(file_id)
        metadata['content_length'] = len(content)
        self._save_metadata(file_id, metadata)
        
        return {
            'file_id': file_id,
            'content': content,
            'preview': content[:500] + "..." if len(content) > 500 else content
        }
    
    def save_media_files(self, files):
        """
        Lưu nhiều file media
        
        Args:
            files: List các file object
            
        Returns:
            Dictionary chứa thông tin các file đã lưu
        """
        batch_id = self._generate_file_id()
        batch_folder = os.path.join(self.media_folder, batch_id)
        os.makedirs(batch_folder, exist_ok=True)
        
        saved_files = []
        
        for file in files:
            filename = secure_filename(file.filename)
            extension = self._get_file_extension(filename)
            
            # Kiểm tra extension
            if extension not in self.allowed_media_extensions:
                continue
            
            # Lưu file
            file_path = os.path.join(batch_folder, filename)
            file.save(file_path)
            
            # Xác định loại media
            media_type = self._get_media_type(extension)
            
            saved_files.append({
                'filename': filename,
                'path': file_path,
                'type': media_type,
                'size': os.path.getsize(file_path)
            })
        
        # Lưu metadata của batch
        batch_metadata = {
            'batch_id': batch_id,
            'upload_time': datetime.now().isoformat(),
            'total_files': len(saved_files),
            'files': saved_files
        }
        
        metadata_path = os.path.join(self.metadata_folder, f"batch_{batch_id}.json")
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(batch_metadata, f, ensure_ascii=False, indent=2)
        
        return {
            'batch_id': batch_id,
            'files': saved_files
        }
    
    def _get_media_type(self, extension):
        """
        Xác định loại media từ extension
        
        Args:
            extension: Extension của file
            
        Returns:
            Loại media ('audio', 'image', 'video')
        """
        audio_ext = {'.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'}
        image_ext = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'}
        video_ext = {'.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm'}
        
        if extension in audio_ext:
            return 'audio'
        elif extension in image_ext:
            return 'image'
        elif extension in video_ext:
            return 'video'
        else:
            return 'unknown'
    
    def get_guideline_content(self, guideline_id):
        """
        Lấy nội dung guideline đã được extract
        
        Args:
            guideline_id: ID của guideline
            
        Returns:
            Nội dung guideline
        """
        content_path = os.path.join(self.metadata_folder, f"{guideline_id}_content.txt")
        if not os.path.exists(content_path):
            raise FileNotFoundError(f"Không tìm thấy nội dung guideline {guideline_id}")
        
        with open(content_path, 'r', encoding='utf-8') as f:
            return f.read()
    
    def get_guideline_file_path(self, guideline_id):
        """
        Lấy đường dẫn file guideline gốc để sử dụng với File API
        
        Args:
            guideline_id: ID của guideline
            
        Returns:
            Đường dẫn file guideline gốc hoặc None nếu không tìm thấy
        """
        # Tìm file trong upload folder
        search_folders = [self.guideline_folder, self.upload_folder]
        for folder in search_folders:
            if not os.path.isdir(folder):
                continue
            for filename in os.listdir(folder):
                if not filename.startswith(f"{guideline_id}_"):
                    continue
                file_path = os.path.join(folder, filename)
                # Kiểm tra xem có phải file guideline không (PDF, DOCX, TXT)
                ext = self._get_file_extension(filename).lower()
                if ext in ['.pdf', '.docx', '.txt']:
                    return file_path
        return None

    def save_guideline_rules(self, guideline_id: str, rules: Dict[str, Any]) -> str:
        """Lưu bộ quy tắc (rules) đã phân tích từ guideline thành file JSON trong metadata folder

        Args:
            guideline_id: ID của guideline
            rules: Dictionary chứa danh sách rule đã phân tích

        Returns:
            Đường dẫn tới file rules JSON
        """
        rules_path = os.path.join(self.metadata_folder, f"{guideline_id}_rules.json")

        # Lưu file rules
        with open(rules_path, 'w', encoding='utf-8') as f:
            json.dump(rules, f, ensure_ascii=False, indent=2)

        # Cập nhật metadata của guideline để biết đã có rules
        try:
            metadata = self._load_metadata(guideline_id)
        except FileNotFoundError:
            metadata = {}

        metadata['has_rules'] = True
        metadata['rules_path'] = rules_path
        metadata['rules_last_updated'] = datetime.now().isoformat()
        self._save_metadata(guideline_id, metadata)

        return rules_path

    def get_guideline_rules(self, guideline_id: str) -> Dict[str, Any]:
        """Đọc bộ quy tắc (rules) đã lưu cho guideline

        Args:
            guideline_id: ID của guideline

        Returns:
            Dictionary rules
        """
        rules_path = os.path.join(self.metadata_folder, f"{guideline_id}_rules.json")
        if not os.path.exists(rules_path):
            raise FileNotFoundError(f"Không tìm thấy rules cho guideline {guideline_id}")

        with open(rules_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def get_data_info(self, data_id):
        """
        Lấy thông tin data (columns, preview) từ data_id
        
        Args:
            data_id: ID của data
            
        Returns:
            Dictionary chứa thông tin data
        """
        data_path = os.path.join(self.metadata_folder, f"{data_id}_data.json")
        if not os.path.exists(data_path):
            raise FileNotFoundError(f"Không tìm thấy data {data_id}")
        
        # Lấy metadata để có columns và preview
        metadata = self._load_metadata(data_id)
        return {
            'columns': metadata.get('columns', []),
            'preview': metadata.get('preview', []),
            'rows': metadata.get('rows', 0)
        }
    
    def get_data_for_qa(self, data_id):
        """
        Lấy data để thực hiện QA
        
        Args:
            data_id: ID của data
            
        Returns:
            Dictionary chứa data
        """
        data_path = os.path.join(self.metadata_folder, f"{data_id}_data.json")
        if not os.path.exists(data_path):
            raise FileNotFoundError(f"Không tìm thấy data {data_id}")
        
        with open(data_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        metadata = self._load_metadata(data_id)
        
        return {
            'data_id': data_id,
            'data': data,
            'metadata': metadata
        }
    
    def get_media_files(self, batch_id):
        """
        Lấy thông tin các file media trong batch
        
        Args:
            batch_id: ID của batch media
            
        Returns:
            Dictionary chứa thông tin media files
        """
        metadata_path = os.path.join(self.metadata_folder, f"batch_{batch_id}.json")
        if not os.path.exists(metadata_path):
            raise FileNotFoundError(f"Không tìm thấy batch media {batch_id}")
        
        with open(metadata_path, 'r', encoding='utf-8') as f:
            return json.load(f)
