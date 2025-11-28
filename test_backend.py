"""
Script test backend đơn giản
"""
import sys
import os

# Thêm backend vào path
sys.path.insert(0, 'backend')

print("Testing imports...")
try:
    from modules.file_handler import FileHandler
    print("✓ FileHandler OK")
except Exception as e:
    print(f"✗ FileHandler Error: {e}")

try:
    from modules.ai_integration import AIIntegration
    print("✓ AIIntegration OK")
except Exception as e:
    print(f"✗ AIIntegration Error: {e}")

try:
    from modules.prompt_generator import PromptGenerator
    print("✓ PromptGenerator OK")
except Exception as e:
    print(f"✗ PromptGenerator Error: {e}")

try:
    from modules.qa_processor import QAProcessor
    print("✓ QAProcessor OK")
except Exception as e:
    print(f"✗ QAProcessor Error: {e}")

print("\nTesting Flask app...")
try:
    os.chdir('backend')
    import app
    print("✓ Flask app OK")
except Exception as e:
    print(f"✗ Flask app Error: {e}")
    import traceback
    traceback.print_exc()
