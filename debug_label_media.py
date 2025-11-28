import os
import pandas as pd

from backend.modules.label_processor import LabelProcessor

EXCEL_PATH = r"d:\Abc\spd\test\testlabel\Book1.xlsx"
MEDIA_DIR = r"d:\Abc\spd\test\testlabel\tet1\tet1\image"
TARGET_ID = "034504a8-08c5-4e83-a1dc-188d3f4b5f9c"

print("[DEBUG] EXCEL_PATH:", EXCEL_PATH)
print("[DEBUG] MEDIA_DIR:", MEDIA_DIR)

if not os.path.exists(EXCEL_PATH):
    print("[ERROR] Excel file not found")
    raise SystemExit(1)

if not os.path.isdir(MEDIA_DIR):
    print("[ERROR] Media dir not found")
    raise SystemExit(1)

# Load Excel
df = pd.read_excel(EXCEL_PATH)
print("[DEBUG] Columns:", list(df.columns))
print("[DEBUG] First 5 rows:")
print(df.head())

# Try to find row with given _id
row = None
if "_id" in df.columns:
    matches = df[df["_id"] == TARGET_ID]
    if len(matches) > 0:
        row = matches.iloc[0].to_dict()
        print("[DEBUG] Found row with _id=", TARGET_ID)
    else:
        print("[WARN] No row found with _id=", TARGET_ID)
else:
    print("[WARN] '_id' column not in Excel")

if row is None:
    # just use first row for demo
    row = df.iloc[0].to_dict()
    print("[DEBUG] Using first row as sample, _id=", row.get("_id"))

# Build media_files list
files = []
for fn in os.listdir(MEDIA_DIR):
    lower = fn.lower()
    if lower.endswith((".jpg", ".jpeg", ".png", ".webp", ".bmp")):
        files.append({
            "filename": fn,
            "path": os.path.join(MEDIA_DIR, fn),
            "type": "image",
        })

print("[DEBUG] Total media files found:", len(files))

lp = LabelProcessor()
media_index = lp._build_media_index({"files": files})
print("[DEBUG] media_index size:", len(media_index))
print("[DEBUG] media_index sample keys:", list(media_index.keys())[:20])

column_mapping = {
    "_id": {
        "type": "media_name",
        "isMediaColumn": True,
    }
}

media_info = lp._get_media_for_row(row, column_mapping, media_index)
print("[DEBUG] media_info for target row:", media_info)
