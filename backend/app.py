"""
File chính của ứng dụng Flask Backend
Xử lý các API endpoints cho hệ thống QA Data Labeling
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask.json.provider import DefaultJSONProvider
import os
from datetime import datetime
import json
import numpy as np
import pandas as pd
import threading
import time

# Custom JSON encoder để xử lý numpy/pandas types
class CustomJSONProvider(DefaultJSONProvider):
    def default(self, obj):
        if isinstance(obj, (np.integer, np.int64, np.int32)):
            return int(obj)
        elif isinstance(obj, (np.floating, np.float64, np.float32)):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        elif isinstance(obj, (pd.Timestamp, datetime)):
            return obj.isoformat()
        return super().default(obj)

# Import các module tự định nghĩa
from modules.file_handler import FileHandler
from modules.ai_integration import AIIntegration
from modules.prompt_generator import PromptGenerator
from modules.qa_processor import QAProcessor
from modules.label_processor import LabelProcessor
from modules.compare_processor import CompareProcessor
from modules.user_manager import UserManager
from modules.aicard_manager import AICardManager

# Khởi tạo Flask app
app = Flask(__name__)
app.json = CustomJSONProvider(app)
CORS(app)  # Cho phép CORS để frontend có thể gọi API

# Cấu hình thư mục upload
UPLOAD_FOLDER = 'uploads'
RESULT_FOLDER = 'results'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(RESULT_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['RESULT_FOLDER'] = RESULT_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max file size

# Khởi tạo các module
file_handler = FileHandler(UPLOAD_FOLDER)
prompt_generator = PromptGenerator()
qa_processor = QAProcessor()
label_processor = LabelProcessor()
compare_processor = CompareProcessor()
user_manager = UserManager(RESULT_FOLDER)
aicard_manager = AICardManager(RESULT_FOLDER)


def _start_auto_verification(qa_id: str, verifiers_config):
    """Khởi chạy verification tự động sau khi QA hoàn thành.

    Args:
        qa_id: ID của QA job
        verifiers_config: List config verifiers từ frontend
    """

    def _worker():
        try:
            # Đợi QA hoàn thành
            while True:
                try:
                    status = qa_processor.get_qa_status(qa_id)
                except Exception as e:
                    print(f"[AUTO_VERIFY] Lỗi khi lấy trạng thái QA {qa_id}: {str(e)}", flush=True)
                    return

                state = status.get('status')
                if state in ['completed', 'failed']:
                    break
                time.sleep(2)

            if state != 'completed':
                print(f"[AUTO_VERIFY] QA {qa_id} ở trạng thái {state}, bỏ qua auto verification", flush=True)
                return

            # Lấy kết quả QA đầy đủ
            try:
                qa_result = qa_processor.get_qa_result(qa_id)
            except Exception as e:
                print(f"[AUTO_VERIFY] Lỗi khi lấy kết quả QA {qa_id}: {str(e)}", flush=True)
                return

            # Khởi tạo AI instances cho verifiers
            ai_instances = []
            for idx, verifier in enumerate(verifiers_config):
                try:
                    api_key = verifier.get('api_key') or verifier.get('apiKey') or verifier.get('apiKey'.lower()) or verifier.get('apiKey')
                    if not api_key:
                        print(f"[AUTO_VERIFY] Bỏ qua verifier {idx + 1} vì thiếu API key", flush=True)
                        continue

                    provider = verifier.get('provider') or verifier.get('model') or 'gemini'
                    specific_model = verifier.get('specificModel')

                    if not specific_model:
                        if provider == 'gemini':
                            specific_model = 'gemini-2.5-flash'
                        elif provider == 'chatgpt':
                            specific_model = 'gpt-4o'
                        else:
                            specific_model = provider

                    prompt = verifier.get('prompt')
                    if not prompt:
                        print(f"[AUTO_VERIFY] Bỏ qua verifier {idx + 1} vì thiếu prompt", flush=True)
                        continue

                    ai = AIIntegration(provider, api_key, specific_model)
                    ai_instances.append({'ai': ai, 'prompt': prompt})
                except Exception as e:
                    print(f"[AUTO_VERIFY] Lỗi khi khởi tạo verifier {idx + 1}: {str(e)}", flush=True)

            if not ai_instances:
                print(f"[AUTO_VERIFY] Không có verifier hợp lệ cho QA {qa_id}", flush=True)
                return

            # Thực hiện đối chiếu
            try:
                qa_processor.verify_qa(qa_result=qa_result, ai_instances=ai_instances)
                print(f"[AUTO_VERIFY] Đã chạy verification tự động cho QA {qa_id}", flush=True)
            except Exception as e:
                print(f"[AUTO_VERIFY] Lỗi khi chạy verification cho QA {qa_id}: {str(e)}", flush=True)

        except Exception as e:
            print(f"[AUTO_VERIFY] Lỗi không mong đợi: {str(e)}", flush=True)

    t = threading.Thread(target=_worker, daemon=True)
    t.start()

@app.route('/api/health', methods=['GET'])
def health_check():
    """
    Endpoint kiểm tra trạng thái server
    """
    return jsonify({
        'status': 'ok',
        'message': 'Server đang hoạt động',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/upload/data', methods=['POST'])
def upload_data():
    """
    Upload file data Excel
    Nhận file Excel chứa data cần QA
    """
    print("\n" + "="*50, flush=True)
    print("[INFO] Nhận request upload data", flush=True)
    try:
        if 'file' not in request.files:
            print("[ERROR] Không có file trong request")
            return jsonify({'error': 'Không tìm thấy file'}), 400
        
        file = request.files['file']
        print(f"[INFO] File name: {file.filename}")
        
        if file.filename == '':
            print("[ERROR] Tên file trống")
            return jsonify({'error': 'Tên file trống'}), 400
        
        # Lưu file và parse data
        print("[INFO] Đang lưu file...")
        file_path = file_handler.save_uploaded_file(file, 'data')
        print(f"[INFO] File đã lưu tại: {file_path}")
        
        print("[INFO] Đang parse Excel...", flush=True)
        data_info = file_handler.parse_excel(file_path)
        
        print(f"[SUCCESS] Parse thành công: {data_info['rows']} rows, {len(data_info['columns'])} columns", flush=True)
        print(f"[DEBUG] Columns: {data_info['columns']}", flush=True)
        print("="*50 + "\n", flush=True)
        
        response_data = {
            'success': True,
            'message': 'Upload file data thành công',
            'file_id': data_info['file_id'],
            'rows': data_info['rows'],
            'columns': data_info['columns'],
            'preview': data_info['preview']
        }
        print(f"[DEBUG] Response: rows={response_data['rows']}, columns count={len(response_data['columns'])}", flush=True)
        
        return jsonify(response_data)
    
    except Exception as e:
        print(f"[ERROR] Lỗi khi upload data: {str(e)}")
        import traceback
        traceback.print_exc()
        print("="*50 + "\n")
        return jsonify({'error': str(e)}), 500

@app.route('/api/upload/guideline', methods=['POST'])
def upload_guideline():
    """
    Upload file guideline (PDF, Excel, Word, TXT)
    """
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'Không tìm thấy file'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'Tên file trống'}), 400
        
        # Lưu file và extract nội dung
        file_path = file_handler.save_uploaded_file(file, 'guideline')
        guideline_content = file_handler.extract_guideline_content(file_path)
        
        return jsonify({
            'success': True,
            'message': 'Upload guideline thành công',
            'file_id': guideline_content['file_id'],
            'content_preview': guideline_content['preview']
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/aicard/attributes/values', methods=['GET'])
def get_aicard_attribute_values():
    """Trả về danh sách giá trị gợi ý cho một cột thuộc tính của AI Card project.

    Query params:
      - project_id: ID của AI Card project
      - attr_column: tên cột thuộc tính cần lấy giá trị
      - search, selected_filter: optional, để thống nhất với bộ lọc hiện tại
    """
    try:
        project_id = (request.args.get('project_id') or '').strip()
        if not project_id:
            return jsonify({'error': 'Thiếu project_id'}), 400

        attr_column = (request.args.get('attr_column') or '').strip()
        if not attr_column:
            return jsonify({'error': 'Thiếu attr_column'}), 400

        search = request.args.get('search') or None
        selected_filter = request.args.get('selected_filter') or 'all'
        primary_attr_key = request.args.get('primary_attr_key') or None
        primary_attr_value = request.args.get('primary_attr_value') or None

        # Lấy toàn bộ cards sau khi áp dụng filter search/selected + primary_attr
        cards = aicard_manager._load_cards(project_id)
        cards = aicard_manager._apply_filters(
            cards,
            search=search,
            selected_filter=selected_filter,
            primary_attr_key=primary_attr_key,
            primary_attr_value=primary_attr_value,
        )

        key_lower = attr_column.lower()
        counts = {}

        for card in cards:
            if not isinstance(card, dict):
                continue
            attrs = card.get('attributes') or {}
            if not isinstance(attrs, dict):
                continue

            value = None
            for k, v in attrs.items():
                try:
                    if str(k).lower() == key_lower:
                        value = v
                        break
                except Exception:
                    continue

            if value is None:
                continue

            try:
                raw = '' if value is None else str(value)
            except Exception:
                raw = ''

            parts = raw.split(',') if ',' in raw else [raw]
            labels = set(p.strip() for p in parts if p.strip()) or {'(trống)'}
            for label in labels:
                counts[label] = counts.get(label, 0) + 1

        values = [
            {'value': label, 'count': count}
            for label, count in sorted(counts.items(), key=lambda x: (-x[1], str(x[0])))[:50]
        ]

        return jsonify({'success': True, 'project_id': project_id, 'attr_column': attr_column, 'values': values})

    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 404
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/compare/export-with-overrides/<compare_id>', methods=['POST'])
def export_compare_with_overrides(compare_id):
    """Export kết quả so sánh ra Excel, cho phép override final_values từ frontend."""
    try:
        data = request.json or {}
        overrides_rows = data.get('rows') or []

        export_path = compare_processor.export_result(
            compare_id,
            app.config['RESULT_FOLDER'],
            overrides_rows=overrides_rows,
        )

        return send_file(
            export_path,
            as_attachment=True,
            download_name=f'compare_result_{compare_id}.xlsx',
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/label/resume-from-checkpoint/<label_id>', methods=['POST'])
def resume_label_from_checkpoint(label_id):
    """Resume LABELING từ checkpoint đã lưu (sau khi backend restart).

    Yêu cầu frontend gửi lại api_key (bắt buộc). provider/specific_model/prompt
    có thể lấy từ body hoặc từ checkpoint đã lưu.
    """
    try:
        data = request.json or {}

        # Lấy checkpoint từ file
        checkpoint = label_processor.get_label_result(label_id)
        status = checkpoint.get('status')
        if status in ['completed', 'failed']:
            return jsonify({'error': f'Label job {label_id} đã ở trạng thái {status}, không thể resume'}), 400

        api_key = data.get('api_key') or data.get('apiKey')
        if not api_key:
            return jsonify({'error': 'Thiếu api_key để resume LABELING từ checkpoint'}), 400

        provider = data.get('provider') or checkpoint.get('provider') or 'gemini'
        specific_model = (
            data.get('specific_model')
            or data.get('specificModel')
            or checkpoint.get('model_version')
        )
        if not specific_model:
            if provider == 'gemini':
                specific_model = 'gemini-2.5-flash'
            elif provider == 'chatgpt':
                specific_model = 'gpt-4o'
            else:
                specific_model = provider

        prompt_value = data.get('prompt') or checkpoint.get('prompt')
        if not prompt_value:
            return jsonify({'error': 'Không tìm thấy prompt trong checkpoint hoặc request body để resume LABELING'}), 400

        # Khởi tạo AI
        ai = AIIntegration(provider, api_key, specific_model)

        data_id = checkpoint.get('data_id')
        guideline_id = checkpoint.get('guideline_id')
        if not data_id or not guideline_id:
            return jsonify({'error': 'Checkpoint thiếu data_id hoặc guideline_id, không thể resume LABELING'}), 400

        # Load lại data
        label_data = file_handler.get_data_for_qa(data_id)

        # Nạp guideline rules nếu có
        try:
            guideline_rules = file_handler.get_guideline_rules(guideline_id)
            label_data['guideline_rules'] = guideline_rules
        except FileNotFoundError:
            label_data['guideline_rules'] = None
        except Exception as e:
            print(f"[WARNING] Failed to load guideline rules for resume LABEL {label_id}: {str(e)}", flush=True)
            label_data['guideline_rules'] = None

        # Output config
        output_config = checkpoint.get('output_config')
        if output_config is not None:
            label_data['output_config'] = output_config

        # Media (nếu có)
        if checkpoint.get('has_media'):
            media_files = checkpoint.get('media_files')
            if media_files:
                label_data['media_files'] = media_files

        result = label_processor.start_label_from_checkpoint(
            label_id=label_id,
            checkpoint=checkpoint,
            label_data=label_data,
            ai_instance=ai,
            prompt=prompt_value,
        )

        return jsonify({
            'success': True,
            'label_id': result['label_id'],
            'status': result['status'],
            'message': 'Đã resume LABELING từ checkpoint',
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/label/status/<label_id>', methods=['GET'])
def get_label_status(label_id):
    """Lấy trạng thái job labeling (tiến độ)."""
    try:
        status = label_processor.get_label_status(label_id)
        return jsonify(status)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/label/result/<label_id>', methods=['GET'])
def get_label_result(label_id):
    """Lấy kết quả labeling đầy đủ cho label_id."""
    try:
        result = label_processor.get_label_result(label_id)
        return jsonify(result)
    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/label/export/<label_id>', methods=['GET'])
def export_label_result(label_id):
    """Export kết quả labeling ra Excel."""
    try:
        export_path = label_processor.export_result(label_id, app.config['RESULT_FOLDER'])
        return send_file(
            export_path,
            as_attachment=True,
            download_name=f'label_result_{label_id}.xlsx',
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/compare/start', methods=['POST'])
def start_compare():
    """Bắt đầu job so sánh nhiều file data theo cột ID và các cột cần so sánh."""
    try:
        data = request.json or {}

        datasets_req = data.get('datasets') or []
        id_column = data.get('id_column') or data.get('idColumn')
        compare_columns = data.get('compare_columns') or data.get('compareColumns') or []
        guideline_id = data.get('guideline_id') or data.get('guidelineId')
        media_batch_id = data.get('media_batch_id') or data.get('mediaBatchId')
        media_column = data.get('media_column') or data.get('mediaColumn')
        project_id = data.get('project_id') or data.get('projectId')
        reference_index_raw = (
            data.get('reference_index')
            or data.get('referenceIndex')
            or 0
        )

        try:
            reference_index = int(reference_index_raw)
        except Exception:
            reference_index = 0

        if not id_column:
            return jsonify({'error': 'Thiếu id_column'}), 400

        if not datasets_req:
            return jsonify({'error': 'Cần ít nhất 1 dataset để so sánh/kiểm tra'}), 400

        if len(datasets_req) > 5:
            return jsonify({'error': 'Tối đa 5 dataset để so sánh'}), 400

        if not compare_columns:
            return jsonify({'error': 'Thiếu compare_columns'}), 400

        datasets = []
        for ds in datasets_req:
            data_id = ds.get('data_id') or ds.get('dataId')
            label = ds.get('label')

            if not data_id:
                return jsonify({'error': 'Thiếu data_id trong datasets'}), 400

            data_info = file_handler.get_data_for_qa(data_id)
            rows = data_info.get('data') or []
            metadata = data_info.get('metadata') or {}

            datasets.append({
                'data_id': data_id,
                'label': label,
                'rows': rows,
                'metadata': metadata,
            })

        media_files = None
        if media_batch_id:
            try:
                media_files = file_handler.get_media_files(media_batch_id)
            except FileNotFoundError:
                media_files = None
            except Exception as e:
                print(f"[WARNING] Failed to load media files for compare: {str(e)}", flush=True)
                media_files = None

        compare_payload = {
            'datasets': datasets,
            'id_column': id_column,
            'compare_columns': compare_columns,
            'reference_index': reference_index,
            'guideline_id': guideline_id,
            'media_batch_id': media_batch_id,
            'media_column': media_column,
            'media_files': media_files,
        }

        result = compare_processor.start_compare(compare_payload)

        # Nếu có project_id thì gắn compare session vào project (project_type = 'compare')
        if project_id:
            try:
                compare_config_for_project = {
                    'id_column': id_column,
                    'compare_columns': compare_columns,
                    'reference_index': reference_index,
                    'media_column': media_column,
                    'datasets_info': [
                        {
                            'data_id': ds.get('data_id'),
                            'label': ds.get('label'),
                        }
                        for ds in datasets
                    ],
                }
                qa_processor.attach_compare_to_project(
                    project_id=project_id,
                    compare_id=result['compare_id'],
                    compare_config=compare_config_for_project,
                )
            except Exception as e:
                print(f"[WARNING] Failed to attach COMPARE to project {project_id}: {str(e)}", flush=True)

        return jsonify({
            'success': True,
            'compare_id': result['compare_id'],
            'status': result['status'],
            'message': 'Đã bắt đầu job so sánh',
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/compare/status/<compare_id>', methods=['GET'])
def get_compare_status(compare_id):
    """Lấy trạng thái job so sánh (tiến độ + summary nếu có)."""
    try:
        status = compare_processor.get_compare_status(compare_id)
        return jsonify(status)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/compare/result/<compare_id>', methods=['GET'])
def get_compare_result(compare_id):
    """Lấy kết quả so sánh đầy đủ cho compare_id."""
    try:
        result = compare_processor.get_compare_result(compare_id)
        return jsonify(result)
    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/compare/export/<compare_id>', methods=['GET'])
def export_compare_result(compare_id):
    """Export kết quả so sánh ra Excel."""
    try:
        export_path = compare_processor.export_result(compare_id, app.config['RESULT_FOLDER'])
        return send_file(
            export_path,
            as_attachment=True,
            download_name=f'compare_result_{compare_id}.xlsx',
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/label/start', methods=['POST'])
def start_labeling():
    """Bắt đầu quá trình LABELING với 1 model AI.

    Cơ chế tương tự start_qa nhưng thay vì is_correct, hệ thống sẽ gán nhãn mới
    cho từng dòng data theo guideline.
    """
    try:
        data = request.json

        # Validate input
        required_fields = ['data_id', 'guideline_id', 'api_key', 'prompt']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Thiếu trường {field}'}), 400

        # Thông tin model
        provider = data.get('provider', data.get('model', 'chatgpt'))
        specific_model = data.get('specificModel') or data.get('model')

        # Column mapping cho labeling
        column_mapping = data.get('columnMapping', {})

        # Project id (optional, để sau có thể gắn session labeling vào project nếu cần)
        project_id = data.get('project_id')

        # Khởi tạo AI Integration cho labeling
        ai = AIIntegration(provider, data['api_key'], specific_model)

        # Lấy data cần label
        label_data = file_handler.get_data_for_qa(data['data_id'])

        # Cấu hình output cho labeling (danh sách key trong labels)
        output_config = data.get('output_config') or data.get('outputConfig')
        if output_config:
            label_data['output_config'] = output_config

        # Nạp bộ quy tắc (rules) đã phân tích từ guideline nếu có
        try:
            guideline_rules = file_handler.get_guideline_rules(data['guideline_id'])
            label_data['guideline_rules'] = guideline_rules
        except FileNotFoundError:
            label_data['guideline_rules'] = None
        except Exception as e:
            print(f"[WARNING] Failed to load guideline rules for labeling {data['guideline_id']}: {str(e)}", flush=True)
            label_data['guideline_rules'] = None

        # Kiểm tra nếu có media
        # Ưu tiên nhận trực tiếp danh sách media_files từ frontend (case upload mới, có đầy đủ path/filename)
        media_files_payload = data.get('media_files') or data.get('mediaFiles')
        media_batch_id = data.get('media_batch_id')

        # Debug: log thông tin media nhận được từ request
        try:
            if isinstance(media_files_payload, list):
                print(
                    f"[DEBUG][Label][start] media_files_payload list length = {len(media_files_payload)}; sample = {media_files_payload[:2]}",
                    flush=True,
                )
            elif isinstance(media_files_payload, dict):
                files = media_files_payload.get('files') or []
                print(
                    f"[DEBUG][Label][start] media_files_payload dict, files length = {len(files)}; sample = {files[:2]}",
                    flush=True,
                )
            else:
                print(
                    f"[DEBUG][Label][start] media_files_payload = {type(media_files_payload)}; media_batch_id = {media_batch_id}",
                    flush=True,
                )
        except Exception:
            pass

        if media_files_payload:
            # Có thể là list các file hoặc dict đã chứa 'files'
            if isinstance(media_files_payload, list):
                label_data['media_files'] = {'files': media_files_payload}
            elif isinstance(media_files_payload, dict):
                label_data['media_files'] = media_files_payload
        elif media_batch_id:
            # Backward-compat / case reuse project: chỉ có batch_id, backend tự load metadata
            media_files = file_handler.get_media_files(media_batch_id)
            label_data['media_files'] = media_files

        # Bắt đầu labeling
        label_result = label_processor.process_labeling(
            label_data=label_data,
            ai_instance=ai,
            prompt=data['prompt'],
            guideline_id=data['guideline_id'],
            column_mapping=column_mapping
        )

        # Nếu có project_id thì gắn LABEL session vào project để lưu mapping + cấu hình
        if project_id:
            try:
                label_config_for_project = {
                    'provider': provider,
                    'specificModel': specific_model,
                    'model': data.get('model'),
                    'prompt': data['prompt'],
                    'output_config': output_config,
                }
                qa_processor.attach_label_to_project(
                    project_id=project_id,
                    label_id=label_result['label_id'],
                    column_mapping=column_mapping,
                    label_config=label_config_for_project,
                )
            except Exception as e:
                print(f"[WARNING] Failed to attach LABEL {label_result['label_id']} to project {project_id}: {str(e)}", flush=True)

        return jsonify({
            'success': True,
            'label_id': label_result['label_id'],
            'status': 'processing',
            'message': 'Đã bắt đầu quá trình labeling'
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/media/<batch_id>/<filename>', methods=['GET'])
def get_media_file(batch_id, filename):
    """Trả về file media để frontend hiển thị trong kết quả QA"""
    try:
        media_path = os.path.join(file_handler.media_folder, batch_id, filename)
        if not os.path.exists(media_path):
            return jsonify({'error': 'Không tìm thấy file media'}), 404
        return send_file(media_path)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/upload/media', methods=['POST'])
def upload_media():
    """
    Upload các file media (audio, image, video)
    Hỗ trợ upload từng file, nhiều file hoặc cả folder
    """
    try:
        files = request.files.getlist('files')
        if not files:
            return jsonify({'error': 'Không tìm thấy file media'}), 400
        
        # Lưu các file media
        media_info = file_handler.save_media_files(files)
        
        return jsonify({
            'success': True,
            'message': f'Upload {len(media_info["files"])} file media thành công',
            'batch_id': media_info['batch_id'],
            'files': media_info['files']
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/generate-prompt', methods=['POST'])
def generate_prompt():
    """
    Tự động sinh prompt từ guideline sử dụng Gemini
    """
    try:
        data = request.json
        guideline_id = data.get('guideline_id')
        api_key = data.get('api_key')
        provider = data.get('provider', 'gemini')  # Default to gemini for prompt generation
        specific_model = data.get('specificModel', 'gemini-2.5-flash')
        
        if not guideline_id or not api_key:
            return jsonify({'error': 'Thiếu guideline_id hoặc api_key'}), 400
        
        # Lấy nội dung guideline
        guideline_content = file_handler.get_guideline_content(guideline_id)
        
        # Lấy đường dẫn file guideline để sử dụng File API
        guideline_file_path = file_handler.get_guideline_file_path(guideline_id)

        # Phân tích guideline thành bộ rules có cấu trúc (tổng quát cho nhiều loại guide)
        # Không để việc này làm hỏng flow generate prompt: nếu lỗi chỉ log cảnh báo.
        try:
            rules = prompt_generator.analyze_guideline_to_rules(
                guideline_content,
                api_key,
                specific_model,
                guideline_file_path
            )
            try:
                file_handler.save_guideline_rules(guideline_id, rules)
            except Exception as e:
                print(f"[WARNING] Failed to save guideline rules for {guideline_id}: {str(e)}", flush=True)
        except Exception as e:
            print(f"[WARNING] Failed to analyze guideline rules for {guideline_id}: {str(e)}", flush=True)
            rules = None
        
        # Sinh prompt tự động từ guideline như trước (giữ nguyên behavior cũ)
        generated_prompt = prompt_generator.generate_from_guideline(
            guideline_content, 
            api_key,
            specific_model,
            guideline_file_path
        )
        
        return jsonify({
            'success': True,
            'prompt': generated_prompt
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/label/generate-prompt', methods=['POST'])
def generate_label_prompt():
    """Tự động sinh prompt LABELING từ guideline (giống cơ chế QA nhưng cho gán label).

    Output prompt sẽ hướng dẫn model trả về JSON dạng:
    {
      "labels": { ... },
      "explanation": "...",
      "errors": ["..."]
    }
    """
    try:
        data = request.json
        guideline_id = data.get('guideline_id')
        api_key = data.get('api_key')
        provider = data.get('provider', 'gemini')
        specific_model = data.get('specificModel', 'gemini-2.5-flash')

        if not guideline_id or not api_key:
            return jsonify({'error': 'Thiếu guideline_id hoặc api_key'}), 400

        # Lấy nội dung guideline
        guideline_content = file_handler.get_guideline_content(guideline_id)
        guideline_file_path = file_handler.get_guideline_file_path(guideline_id)

        # Phân tích guideline thành rules có cấu trúc (tái sử dụng cho labeling)
        try:
            rules = prompt_generator.analyze_guideline_to_rules(
                guideline_content,
                api_key,
                specific_model,
                guideline_file_path
            )
            try:
                file_handler.save_guideline_rules(guideline_id, rules)
            except Exception as e:
                print(f"[WARNING] Failed to save guideline rules for labeling {guideline_id}: {str(e)}", flush=True)
        except Exception as e:
            print(f"[WARNING] Failed to analyze guideline rules for labeling {guideline_id}: {str(e)}", flush=True)

        # Sinh prompt labeling từ guideline
        generated_prompt = prompt_generator.generate_label_prompt(
            guideline_content,
            api_key,
            specific_model,
            guideline_file_path
        )

        return jsonify({
            'success': True,
            'prompt': generated_prompt
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/qa/start', methods=['POST'])
def start_qa():
    """
    Bắt đầu quá trình QA với 1 model AI (người kiểm tra đầu tiên)
    """
    try:
        data = request.json
        
        # Validate input
        required_fields = ['data_id', 'guideline_id', 'api_key', 'prompt']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Thiếu trường {field}'}), 400
        
        # Lấy thông tin model cho Người QA 1
        provider = data.get('provider', data.get('model', 'chatgpt'))  # Backward compatibility
        specific_model = data.get('specificModel') or data.get('model')
        
        # Lấy column mapping
        column_mapping = data.get('columnMapping', {})

        # Lấy project_id nếu có (để gắn QA session vào project)
        project_id = data.get('project_id')
        
        # Khởi tạo AI Integration cho Người QA 1
        ai = AIIntegration(provider, data['api_key'], specific_model)
        
        # Lấy data cần QA
        qa_data = file_handler.get_data_for_qa(data['data_id'])

        # Nạp bộ quy tắc (rules) đã phân tích từ guideline nếu có
        try:
            guideline_rules = file_handler.get_guideline_rules(data['guideline_id'])
            qa_data['guideline_rules'] = guideline_rules
        except FileNotFoundError:
            # Chưa có rules cho guideline này (có thể do chưa gọi generate-prompt)
            qa_data['guideline_rules'] = None
        except Exception as e:
            print(f"[WARNING] Failed to load guideline rules for {data['guideline_id']}: {str(e)}", flush=True)
            qa_data['guideline_rules'] = None
        
        # Kiểm tra nếu có media
        # Ưu tiên nhận trực tiếp danh sách media_files từ frontend (case upload mới, có đầy đủ path/filename)
        media_files_payload = data.get('media_files') or data.get('mediaFiles')
        media_batch_id = data.get('media_batch_id')

        if media_files_payload:
            if isinstance(media_files_payload, list):
                qa_data['media_files'] = {'files': media_files_payload}
            elif isinstance(media_files_payload, dict):
                qa_data['media_files'] = media_files_payload
        elif media_batch_id:
            # Backward-compat / reuse project: chỉ có batch_id, backend tự load metadata
            media_files = file_handler.get_media_files(media_batch_id)
            qa_data['media_files'] = media_files
        
        # Bắt đầu QA với column mapping
        qa_result = qa_processor.process_qa(
            qa_data=qa_data,
            ai_instance=ai,
            prompt=data['prompt'],
            guideline_id=data['guideline_id'],
            column_mapping=column_mapping
        )

        # Nếu có project_id thì gắn QA session vào project để lưu mapping + cấu hình QA
        if project_id:
            try:
                qa_config_for_project = {
                    'provider': provider,
                    'specificModel': specific_model,
                    'model': data.get('model'),
                    'prompt': data['prompt']
                }
                qa_processor.attach_qa_to_project(
                    project_id=project_id,
                    qa_id=qa_result['qa_id'],
                    column_mapping=column_mapping,
                    qa_config=qa_config_for_project
                )
            except Exception as e:
                # Không làm fail QA nếu gắn vào project lỗi, chỉ log cảnh báo
                print(f"[WARNING] Failed to attach QA to project {project_id}: {str(e)}", flush=True)

        # Nếu có nhiều Người QA (>=2) và có cấu hình verifiers thì tự động chạy verification sau QA
        num_checkers = int(data.get('num_checkers', 1) or 1)
        verifiers_config = data.get('verifiers') or []
        if num_checkers > 1 and verifiers_config:
            try:
                _start_auto_verification(qa_result['qa_id'], verifiers_config)
            except Exception as e:
                print(f"[WARNING] Failed to start auto verification for QA {qa_result['qa_id']}: {str(e)}", flush=True)
        
        return jsonify({
            'success': True,
            'qa_id': qa_result['qa_id'],
            'status': 'processing',
            'message': 'Đã bắt đầu quá trình QA'
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/qa/verify', methods=['POST'])
def verify_qa():
    """
    Đối chiếu kết quả QA với 3 model AI khác
    """
    try:
        data = request.json
        
        # Validate input
        required_fields = ['qa_id', 'verifiers']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Thiếu trường {field}'}), 400
        
        verifiers = data['verifiers']
        if len(verifiers) != 3:
            return jsonify({'error': 'Cần đúng 3 người đối chiếu'}), 400
        
        # Khởi tạo 3 AI instances
        ai_instances = []
        for idx, verifier in enumerate(verifiers):
            # Lấy API key (hỗ trợ cả api_key và apiKey từ frontend)
            api_key = verifier.get('api_key') or verifier.get('apiKey')
            if not api_key:
                raise ValueError(f'Thiếu API key cho người đối chiếu {idx + 1}')

            # Provider/model: frontend đang gửi field `model` như là provider (chatgpt/gemini)
            provider = verifier.get('provider') or verifier.get('model') or 'gemini'
            specific_model = verifier.get('specificModel')

            # Nếu người dùng không chọn model cụ thể, tự map sang model mặc định theo provider
            if not specific_model:
                if provider == 'gemini':
                    specific_model = 'gemini-2.5-flash'
                elif provider == 'chatgpt':
                    specific_model = 'gpt-4o'
                else:
                    specific_model = provider

            if 'prompt' not in verifier or not verifier['prompt']:
                raise ValueError(f'Thiếu prompt cho người đối chiếu {idx + 1}')

            ai = AIIntegration(provider, api_key, specific_model)
            ai_instances.append({
                'ai': ai,
                'prompt': verifier['prompt']
            })
        
        # Lấy kết quả QA ban đầu
        qa_result = qa_processor.get_qa_result(data['qa_id'])
        
        # Thực hiện đối chiếu
        verification_result = qa_processor.verify_qa(
            qa_result=qa_result,
            ai_instances=ai_instances
        )
        
        return jsonify({
            'success': True,
            'verification_id': verification_result['verification_id'],
            'status': 'processing',
            'message': 'Đã bắt đầu quá trình đối chiếu'
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/qa/status/<qa_id>', methods=['GET'])
def get_qa_status(qa_id):
    try:
        status = qa_processor.get_qa_status(qa_id)
        return jsonify(status)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/qa/pause/<qa_id>', methods=['POST'])
def pause_qa(qa_id):
    try:
        result = qa_processor.pause_qa(qa_id)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/qa/resume/<qa_id>', methods=['POST'])
def resume_qa(qa_id):
    try:
        result = qa_processor.resume_qa(qa_id)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/qa/resume-from-checkpoint/<qa_id>', methods=['POST'])
def resume_qa_from_checkpoint(qa_id):
    """Resume QA từ checkpoint đã lưu (sau khi backend restart).

    Yêu cầu frontend gửi lại api_key (bắt buộc). provider/specific_model/prompt
    có thể lấy từ body hoặc từ checkpoint đã lưu.
    """
    try:
        data = request.json or {}

        # Lấy checkpoint từ file
        checkpoint = qa_processor.get_qa_result(qa_id)
        status = checkpoint.get('status')
        if status in ['completed', 'failed']:
            return jsonify({'error': f'QA job {qa_id} đã ở trạng thái {status}, không thể resume'}), 400

        api_key = data.get('api_key') or data.get('apiKey')
        if not api_key:
            return jsonify({'error': 'Thiếu api_key để resume QA từ checkpoint'}), 400

        provider = data.get('provider') or checkpoint.get('provider') or 'gemini'
        specific_model = (
            data.get('specific_model')
            or data.get('specificModel')
            or checkpoint.get('model_version')
        )
        if not specific_model:
            if provider == 'gemini':
                specific_model = 'gemini-2.5-flash'
            elif provider == 'chatgpt':
                specific_model = 'gpt-4o'
            else:
                specific_model = provider

        prompt_value = data.get('prompt') or checkpoint.get('prompt')
        if not prompt_value:
            return jsonify({'error': 'Không tìm thấy prompt trong checkpoint hoặc request body để resume QA'}), 400

        # Khởi tạo AI
        ai = AIIntegration(provider, api_key, specific_model)

        data_id = checkpoint.get('data_id')
        guideline_id = checkpoint.get('guideline_id')
        if not data_id or not guideline_id:
            return jsonify({'error': 'Checkpoint thiếu data_id hoặc guideline_id, không thể resume QA'}), 400

        # Load lại data
        qa_data = file_handler.get_data_for_qa(data_id)

        # Nạp guideline rules nếu có
        try:
            guideline_rules = file_handler.get_guideline_rules(guideline_id)
            qa_data['guideline_rules'] = guideline_rules
        except FileNotFoundError:
            qa_data['guideline_rules'] = None
        except Exception as e:
            print(f"[WARNING] Failed to load guideline rules for resume QA {qa_id}: {str(e)}", flush=True)
            qa_data['guideline_rules'] = None

        # Media (nếu có)
        if checkpoint.get('has_media'):
            media_files = checkpoint.get('media_files')
            if media_files:
                qa_data['media_files'] = media_files

        result = qa_processor.start_qa_from_checkpoint(
            qa_id=qa_id,
            checkpoint=checkpoint,
            qa_data=qa_data,
            ai_instance=ai,
            prompt=prompt_value,
        )

        return jsonify({
            'success': True,
            'qa_id': result['qa_id'],
            'status': result['status'],
            'message': 'Đã resume QA từ checkpoint',
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/qa/partial-results/<qa_id>', methods=['GET'])
def get_partial_results(qa_id):
    try:
        results = qa_processor.get_partial_results(qa_id)
        return jsonify(results)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/qa/result/<qa_id>', methods=['GET'])
def get_qa_result(qa_id):
    """
    Lấy kết quả QA hoàn chỉnh
    """
    try:
        result = qa_processor.get_complete_result(qa_id)
        return jsonify(result)
    except FileNotFoundError as e:
        # Không tìm thấy file kết quả QA/verification -> trả 404 để frontend biết là chưa có kết quả
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/qa/export/<qa_id>', methods=['GET'])
def export_qa_result(qa_id):
    """
    Export kết quả QA ra file Excel
    """
    try:
        export_path = qa_processor.export_result(qa_id, app.config['RESULT_FOLDER'])
        return send_file(
            export_path,
            as_attachment=True,
            download_name=f'qa_result_{qa_id}.xlsx'
        )
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/projects/create', methods=['POST'])
def create_project():
    """
    Tạo project mới với metadata
    """
    try:
        current_username = (request.headers.get('X-Current-User') or '').strip()

        current_user = None
        if current_username:
            users = user_manager.list_users()
            for u in users:
                if u.get('username') == current_username:
                    current_user = u
                    break

        if not current_user:
            return jsonify({'error': 'Không xác định được user hiện tại'}), 403

        role = (current_user.get('role') or '').lower()
        perms = current_user.get('permissions') or []
        is_owner = role == 'owner'
        if not is_owner and 'create_project' not in perms:
            return jsonify({'error': 'Bạn không có quyền tạo project'}), 403

        data = request.json or {}
        
        # Validate required fields
        required_fields = ['name', 'data_info']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Thiếu trường {field}'}), 400
        
        # Create project
        project_result = qa_processor.create_project(data)
        
        return jsonify({
            'success': True,
            'project_id': project_result['project_id'],
            'message': 'Tạo project thành công'
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/projects', methods=['GET'])
def list_projects():
    """
    Liệt kê tất cả các project QA
    """
    try:
        projects = qa_processor.list_all_projects()
        return jsonify({
            'success': True,
            'projects': projects
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/projects/<project_id>', methods=['GET'])
def get_project(project_id):
    """
    Lấy thông tin chi tiết project
    """
    try:
        project = qa_processor.get_project(project_id)
        
        # Enrich project with actual data columns if available
        if project.get('data_info', {}).get('file_id'):
            try:
                data_info = file_handler.get_data_info(project['data_info']['file_id'])
                project['data_info']['columns'] = data_info.get('columns', [])
                project['data_info']['preview'] = data_info.get('preview', [])
            except:
                pass  # If data file not found, continue without columns
        
        return jsonify({
            'success': True,
            'project': project
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/projects/<project_id>', methods=['DELETE'])
def delete_project(project_id):
    """Xóa project"""
    try:
        current_username = (request.headers.get('X-Current-User') or '').strip()

        current_user = None
        if current_username:
            users = user_manager.list_users()
            for u in users:
                if u.get('username') == current_username:
                    current_user = u
                    break

        if not current_user:
            return jsonify({'error': 'Không xác định được user hiện tại'}), 403

        role = (current_user.get('role') or '').lower()
        perms = current_user.get('permissions') or []
        is_owner = role == 'owner'
        if not is_owner and 'delete_project' not in perms:
            return jsonify({'error': 'Bạn không có quyền xóa project'}), 403

        qa_processor.delete_project(project_id)
        return jsonify({
            'success': True,
            'message': 'Đã xóa project thành công'
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/aicard/projects/create', methods=['POST'])
def create_aicard_project():
    """Tạo dataset AI Card mới từ một file data (Excel/CSV đã upload)."""
    try:
        current_username = (request.headers.get('X-Current-User') or '').strip()

        current_user = None
        if current_username:
            users = user_manager.list_users()
            for u in users:
                if u.get('username') == current_username:
                    current_user = u
                    break

        if not current_user:
            return jsonify({'error': 'Không xác định được user hiện tại'}), 403

        role = (current_user.get('role') or '').lower()
        perms = current_user.get('permissions') or []
        is_owner = role == 'owner'
        # Tạo dataset AI Card cần quyền chỉnh sửa AI Card
        if not is_owner and 'edit_ai_card' not in perms:
            return jsonify({'error': 'Bạn không có quyền tạo AI Card dataset'}), 403

        data = request.json or {}
        data_id = (data.get('data_id') or '').strip()
        if not data_id:
            return jsonify({'error': 'Thiếu data_id'}), 400

        data_for_qa = file_handler.get_data_for_qa(data_id)
        rows = data_for_qa.get('data') or []
        metadata = data_for_qa.get('metadata') or {}
        columns = metadata.get('columns') or []
        try:
            print(
                f"[AICard] create dataset from data_id={data_id}: rows={len(rows)}, "
                f"meta_rows={metadata.get('rows')}, columns={columns}",
                flush=True,
            )
        except Exception:
            pass

        # Resolve image column as robustly as possible (Files, image_url, url, image, ...)
        image_column_raw = (data.get('image_column') or 'Files').strip()
        image_column = image_column_raw
        if columns:
            lower_map = {str(c).lower(): c for c in columns}
            key = image_column_raw.lower()
            if key in lower_map:
                image_column = lower_map[key]
            else:
                # Try common candidate names
                image_candidates = [
                    image_column_raw,
                    'files',
                    'file',
                    'image_url',
                    'image url',
                    'image',
                    'img',
                    'url',
                    'link',
                    'path',
                    'filepath',
                ]
                resolved = None
                for cand in image_candidates:
                    cand_key = str(cand).lower()
                    if cand_key in lower_map:
                        resolved = lower_map[cand_key]
                        break
                if resolved is None:
                    # Fallback: any column containing image-related keywords
                    image_keywords = ['image', 'img', 'url', 'link', 'file', 'path']
                    for col in columns:
                        col_l = str(col).lower()
                        if any(kw in col_l for kw in image_keywords):
                            resolved = col
                            break
                if resolved is not None:
                    image_column = resolved

        id_column = (data.get('id_column') or '').strip() or None

        # Resolve attribute columns (Occlusion / Expression / Illumination...) with case-insensitive matching
        requested_attr_cols = data.get('attributes_columns') or []
        attributes_columns = []
        if columns:
            lower_map = {str(c).lower(): c for c in columns}

            # Map requested attribute column names to real columns
            for raw in requested_attr_cols:
                if raw is None:
                    continue
                raw_str = str(raw).strip()
                if not raw_str:
                    continue
                if raw_str in columns and raw_str not in attributes_columns:
                    attributes_columns.append(raw_str)
                    continue
                key = raw_str.lower()
                col_name = lower_map.get(key)
                if col_name and col_name not in attributes_columns:
                    attributes_columns.append(col_name)

            # If nothing matched, auto-detect common attribute columns
            if not attributes_columns:
                preferred = ['occlusion', 'expression', 'illumination']
                for key in preferred:
                    col_name = lower_map.get(key)
                    if col_name and col_name not in attributes_columns:
                        attributes_columns.append(col_name)

        project_payload = {
            'name': data.get('name') or metadata.get('original_filename') or f'AI Card {data_id}',
            'description': data.get('description') or '',
            'created_by': current_user.get('username') if current_user else 'Anonymous',
            'created_at': datetime.utcnow().isoformat(),
            'source_data_id': data_id,
            'image_column': image_column,
            'id_column': id_column,
            'attributes_columns': attributes_columns,
            'columns': columns,
        }

        project_info = aicard_manager.create_project(project_payload, rows=rows)

        return jsonify({'success': True, 'project': project_info})

    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/aicard/projects', methods=['GET'])
def list_aicard_projects():
    """Liệt kê các dataset AI Card."""
    try:
        projects = aicard_manager.list_projects()
        return jsonify({'success': True, 'projects': projects})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/aicard/projects/<project_id>', methods=['DELETE'])
def delete_aicard_project(project_id):
    """Xóa một dataset AI Card theo project_id (chỉ Owner/Admin)."""
    try:
        current_username = (request.headers.get('X-Current-User') or '').strip()
        if not current_username:
            return jsonify({'error': 'Thiếu header X-Current-User'}), 401

        current_user = None
        users = user_manager.list_users()
        for u in users:
            if u.get('username') == current_username:
                current_user = u
                break

        if not current_user:
            return jsonify({'error': 'Không xác định được user hiện tại'}), 403

        role = (current_user.get('role') or '').lower()
        perms = current_user.get('permissions') or []
        is_owner = role == 'owner'
        if not is_owner and 'delete_project' not in perms:
            return jsonify({'error': 'Bạn không có quyền xóa AI Card dataset'}), 403

        aicard_manager.delete_project(project_id)

        return jsonify({
            'success': True,
            'message': 'Đã xóa AI Card dataset thành công',
        })

    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/aicard/cards', methods=['GET'])
def list_aicard_cards():
    """Lấy danh sách card (phân trang) cho một AI Card project."""
    try:
        project_id = (request.args.get('project_id') or '').strip()
        if not project_id:
            return jsonify({'error': 'Thiếu project_id'}), 400

        try:
            page = int(request.args.get('page') or 1)
        except Exception:
            page = 1
        try:
            page_size = int(request.args.get('page_size') or 50)
        except Exception:
            page_size = 50

        search = request.args.get('search') or None
        selected_filter = request.args.get('selected_filter') or 'all'
        attr_key = request.args.get('attr_key') or None
        attr_value = request.args.get('attr_value') or None
        primary_attr_key = request.args.get('primary_attr_key') or None
        primary_attr_value = request.args.get('primary_attr_value') or None

        result = aicard_manager.get_cards(
            project_id=project_id,
            page=page,
            page_size=page_size,
            search=search,
            selected_filter=selected_filter,
            attr_key=attr_key,
            attr_value=attr_value,
            primary_attr_key=primary_attr_key,
            primary_attr_value=primary_attr_value,
        )
        resp = {'success': True}
        resp.update(result)
        return jsonify(resp)

    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 404
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/aicard/cards/bulk', methods=['PATCH'])
def update_aicard_cards():
    """Cập nhật tags cho nhiều card AI Card (chọn mẫu training...)."""
    try:
        current_username = (request.headers.get('X-Current-User') or '').strip()

        current_user = None
        if current_username:
            users = user_manager.list_users()
            for u in users:
                if u.get('username') == current_username:
                    current_user = u
                    break

        if not current_user:
            return jsonify({'error': 'Không xác định được user hiện tại'}), 403

        role = (current_user.get('role') or '').lower()
        perms = current_user.get('permissions') or []
        is_owner = role == 'owner'
        if not is_owner and 'edit_ai_card' not in perms:
            return jsonify({'error': 'Bạn không có quyền chỉnh sửa AI Card'}), 403

        data = request.json or {}
        project_id = (data.get('project_id') or '').strip()
        updates = data.get('updates')

        if not project_id:
            return jsonify({'error': 'Thiếu project_id'}), 400
        if not isinstance(updates, list):
            return jsonify({'error': 'updates phải là list'}), 400

        result = aicard_manager.update_cards_tags(project_id, updates)
        resp = {'success': True}
        resp.update(result)
        return jsonify(resp)

    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 404
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/aicard/stats/event', methods=['GET'])
def get_aicard_event_stats():
    """Thống kê Event cho TOÀN BỘ cards của một AI Card project.

    Query params:
      - project_id: ID của AI Card project
      - event_column: tên cột thuộc tính (mặc định 'Event')
    """
    try:
        project_id = (request.args.get('project_id') or '').strip()
        if not project_id:
            return jsonify({'error': 'Thiếu project_id'}), 400

        event_column = request.args.get('event_column') or 'Event'
        search = request.args.get('search') or None
        selected_filter = request.args.get('selected_filter') or 'all'
        attr_key = request.args.get('attr_key') or None
        attr_value = request.args.get('attr_value') or None
        primary_attr_key = request.args.get('primary_attr_key') or None
        primary_attr_value = request.args.get('primary_attr_value') or None

        result = aicard_manager.get_event_stats(
            project_id=project_id,
            event_column=event_column,
            search=search,
            selected_filter=selected_filter,
            attr_key=attr_key,
            attr_value=attr_value,
            primary_attr_key=primary_attr_key,
            primary_attr_value=primary_attr_value,
        )
        resp = {'success': True}
        resp.update(result)
        return jsonify(resp)

    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 404
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/aicard/projects/<project_id>/export', methods=['GET'])
def export_aicard_project(project_id):
    """Export toàn bộ dataset AI Card ra Excel, thêm cột 'Ảnh đẹp'."""
    try:
        # Lấy thông tin project để biết source_data_id
        project = aicard_manager.get_project(project_id)
        source_data_id = project.get('source_data_id')
        if not source_data_id:
            return jsonify({'error': 'AI Card dataset không có source_data_id để export'}), 400

        # Lấy toàn bộ data gốc
        data_for_qa = file_handler.get_data_for_qa(source_data_id)
        rows = data_for_qa.get('data') or []

        # Lấy toàn bộ cards để biết tag Ảnh đẹp (selected_for_training)
        cards = aicard_manager._load_cards(project_id)
        nice_by_row_id = {}
        for card in cards:
            if not isinstance(card, dict):
                continue
            row_id = card.get('row_id')
            tags = card.get('tags') or {}
            is_nice = bool(tags.get('selected_for_training'))
            if isinstance(row_id, int):
                nice_by_row_id[row_id] = is_nice

        # Build DataFrame và thêm cột Ảnh đẹp
        df = pd.DataFrame(rows)
        nice_col = []
        for idx, _ in enumerate(rows):
            nice_col.append(bool(nice_by_row_id.get(idx, False)))

        nice_col_name = 'Ảnh đẹp'
        df[nice_col_name] = nice_col

        export_path = os.path.join(app.config['RESULT_FOLDER'], f'aicard_export_{project_id}.xlsx')
        df.to_excel(export_path, index=False)

        return send_file(
            export_path,
            as_attachment=True,
            download_name=f'aicard_export_{project_id}.xlsx',
        )

    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 404
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ====================== User & Auth APIs ==========================

@app.route('/api/users', methods=['GET'])
def list_users_api():
    """Liệt kê tất cả user (không trả password_hash)."""
    try:
        users = user_manager.list_users()
        return jsonify({
            'success': True,
            'users': users,
            'all_permissions': getattr(user_manager, 'ALL_PERMISSIONS', []),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/users', methods=['POST'])
def create_user_api():
    """Tạo user mới.

    Body JSON:
    - username: str
    - password: str
    - role: 'owner' | 'admin' | 'executive'
    """

    try:
        data = request.json or {}
        username = (data.get('username') or '').strip()
        password = data.get('password') or ''
        role = (data.get('role') or '').strip().lower()

        user = user_manager.create_user(username=username, password=password, role=role)
        return jsonify({'success': True, 'user': user}), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/users/<user_id>', methods=['PUT', 'PATCH'])
def update_user_api(user_id):
    """Cập nhật user: đổi mật khẩu, role hoặc trạng thái hoạt động.

    Body JSON có thể chứa một hoặc nhiều trường:
    - password: str (nếu muốn đổi mật khẩu)
    - role: 'owner' | 'admin' | 'executive'
    - is_active: bool
    """

    try:
        data = request.json or {}
        password = data.get('password')
        role = data.get('role')
        permissions = data.get('permissions')
        is_active = data.get('is_active')

        user = user_manager.update_user(
            user_id=user_id,
            password=password,
            role=role,
            permissions=permissions,
            is_active=is_active,
        )
        return jsonify({'success': True, 'user': user})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/users/<user_id>', methods=['DELETE'])
def delete_user_api(user_id):
    """Xóa user theo id.

    Quy tắc:
    - Chỉ user có role = 'owner' mới được phép xóa user khác.
    - Không cho phép owner tự xóa chính mình.

    FE cần gửi header 'X-Current-User' chứa username đang đăng nhập.
    """
    try:
        current_username = (request.headers.get('X-Current-User') or '').strip()
        if not current_username:
            return jsonify({'error': 'Thiếu header X-Current-User'}), 401

        # Tìm thông tin user hiện tại và user target để kiểm tra role và id
        users = user_manager.list_users()
        current_user_obj = None
        target_user_obj = None
        for u in users:
            if u.get('username') == current_username:
                current_user_obj = u
            if u.get('id') == user_id:
                target_user_obj = u

        if not current_user_obj:
            return jsonify({'error': 'User hiện tại không tồn tại'}), 401

        if (current_user_obj.get('role') or '').lower() != 'owner':
            return jsonify({'error': 'Chỉ Owner mới được quyền xóa user'}), 403

        # Không cho phép owner tự xóa chính mình
        if current_user_obj.get('id') == user_id:
            return jsonify({'error': 'Owner không thể tự xóa tài khoản của mình'}), 400

        # Nếu cố gắng xóa owner khác, cũng không cho phép (đảm bảo luôn có owner)
        if target_user_obj and (target_user_obj.get('role') or '').lower() == 'owner':
            return jsonify({'error': 'Không thể xóa tài khoản Owner khác'}), 400

        user_manager.delete_user(user_id)
        return jsonify({'success': True, 'message': 'Đã xóa user thành công'})
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/login', methods=['POST'])
def login_api():
    """Login đơn giản bằng username/password.

    Trả về thông tin user (không có password_hash) nếu đăng nhập đúng.
    Hiện tại chưa sinh token, FE sẽ tự giữ thông tin user trong state.
    """

    try:
        data = request.json or {}
        username = (data.get('username') or '').strip()
        password = data.get('password') or ''

        user = user_manager.authenticate(username=username, password=password)
        if not user:
            return jsonify({'error': 'Sai username hoặc password'}), 401

        return jsonify({'success': True, 'user': user})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    # Fix encoding cho Windows console
    import sys
    import io
    if sys.platform == 'win32':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    
    print("=" * 50)
    print("Server QA Data Labeling dang khoi dong...")
    print("URL: http://localhost:5000")
    print("=" * 50)
    app.run(debug=True, host='0.0.0.0', port=5000)
