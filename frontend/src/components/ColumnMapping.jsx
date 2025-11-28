/**
 * Component cấu hình mapping các cột Excel
 * Giúp AI hiểu ý nghĩa từng cột và cách mapping với media files
 */

import React, { useState, useEffect } from 'react'
import { Table, FileText, Image, Tag, Info } from 'lucide-react'
import axios from 'axios'

const ColumnMapping = ({
  uploadedData,
  columnMapping,
  setColumnMapping,
  onNext,
  onBack,
  mode = 'qa',
  outputConfig = [],
  setOutputConfig
}) => {
  const [columns, setColumns] = useState([])
  const [mappingTemplates, setMappingTemplates] = useState([])

  // Auto-detect column types based on name and sample data
  const autoDetectColumnType = (columnName, sampleData) => {
    const name = columnName.toLowerCase()
    const sample = sampleData ? String(sampleData).toLowerCase() : ''
    
    // Media file patterns
    if (name.includes('file') || name.includes('image') || name.includes('media') || 
        name.includes('path') || name.includes('url') ||
        sample.includes('.jpg') || sample.includes('.png') || sample.includes('.mp4')) {
      return sample.includes('/') || sample.includes('\\') ? 'media_path' : 'media_name'
    }
    
    // Label/annotation patterns
    if (name.includes('label') || name.includes('annotation') || name.includes('class') || 
        name.includes('category') || name.includes('tag')) {
      return name.includes('class') || name.includes('category') ? 'class' : 'label'
    }
    
    // ID patterns
    if (name.includes('id') || name === 'index' || name === 'idx') {
      return 'id'
    }
    
    // Confidence patterns
    if (name.includes('confidence') || name.includes('score') || name.includes('prob')) {
      return 'confidence'
    }
    
    // Quality patterns
    if (name.includes('quality') || name.includes('flag') || name.includes('status')) {
      return 'quality'
    }
    
    // Annotator patterns
    if (name.includes('annotator') || name.includes('user') || name.includes('reviewer')) {
      return 'annotator'
    }
    
    // Timestamp patterns
    if (name.includes('time') || name.includes('date') || name.includes('created') || 
        name.includes('modified') || sample.includes(':') || sample.includes('-')) {
      return 'timestamp'
    }
    
    return 'other'
  }

  useEffect(() => {
    const info = uploadedData.dataFile?.info
    if (!info) return

    // Case 1: Project đã lưu và có column_mapping -> ưu tiên danh sách cột từ mapping
    if (columnMapping && Object.keys(columnMapping).length > 0) {
      setColumns(Object.keys(columnMapping))
      return
    }

    // Case 2: Flow mới (chưa có mapping) -> khởi tạo từ danh sách cột gốc
    if (Array.isArray(info.columns) && info.columns.length > 0) {
      setColumns(info.columns)
      
      // Khởi tạo mapping mặc định nếu chưa có
      const defaultMapping = {}
      const preview = info.preview || []
      
      info.columns.forEach(col => {
        // Lấy sample data từ dòng đầu tiên
        const sampleData = preview.length > 0 ? preview[0][col] : null
        const detectedType = autoDetectColumnType(col, sampleData)
        
        defaultMapping[col] = {
          type: detectedType,
          description: '',
          isMediaColumn: detectedType === 'media_path' || detectedType === 'media_name'
        }
      })
      setColumnMapping(defaultMapping)
    }
  }, [uploadedData.dataFile, columnMapping])

  // Load các project đã lưu để dùng column_mapping làm preset
  useEffect(() => {
    const fetchMappingTemplates = async () => {
      try {
        const response = await axios.get('/api/projects')
        const projects = response.data?.projects || []
        const withMapping = projects.filter(
          (p) => p.column_mapping && Object.keys(p.column_mapping || {}).length > 0
        )
        setMappingTemplates(withMapping)
      } catch (err) {
        console.error('[ERROR] Failed to load mapping templates from projects:', err)
      }
    }

    fetchMappingTemplates()
  }, [])

  // Mapping templates hiển thị theo loại project (QA vs Labeling)
  const visibleMappingTemplates = React.useMemo(() => {
    if (!mappingTemplates || mappingTemplates.length === 0) return []

    if (mode === 'labeling') {
      return mappingTemplates.filter(p => p.project_type === 'labeling')
    }

    // QA: chỉ lấy project QA hoặc project cũ chưa có project_type
    return mappingTemplates.filter(p => !p.project_type || p.project_type === 'qa')
  }, [mappingTemplates, mode])

  // Các loại cột có thể có
  const columnTypes = [
    { value: 'label', label: 'Label/Annotation', description: 'Cột chứa nhãn đã được gán', icon: '🏷️' },
    { value: 'class', label: 'Class/Category', description: 'Cột phân loại dữ liệu', icon: '📂' },
    { value: 'confidence', label: 'Confidence Score', description: 'Điểm tin cậy của annotation', icon: '📊' },
    { value: 'media_path', label: 'Media File Path', description: 'Đường dẫn đến file media', icon: '🔗' },
    { value: 'media_name', label: 'Media File Name', description: 'Tên file media (để mapping)', icon: '📁' },
    { value: 'id', label: 'ID/Identifier', description: 'Cột định danh duy nhất', icon: '🆔' },
    { value: 'metadata', label: 'Metadata', description: 'Thông tin bổ sung', icon: 'ℹ️' },
    { value: 'quality', label: 'Quality Flag', description: 'Cờ đánh dấu chất lượng', icon: '✅' },
    { value: 'annotator', label: 'Annotator Info', description: 'Thông tin người gán nhãn', icon: '👤' },
    { value: 'timestamp', label: 'Timestamp', description: 'Thời gian tạo/sửa', icon: '⏰' },
    { value: 'other', label: 'Other', description: 'Cột khác', icon: '❓' }
  ]

  const handleColumnTypeChange = (columnName, type) => {
    setColumnMapping({
      ...columnMapping,
      [columnName]: {
        ...columnMapping[columnName],
        type: type,
        isMediaColumn: type === 'media_path' || type === 'media_name'
      }
    })
  }

  const handleDescriptionChange = (columnName, description) => {
    setColumnMapping({
      ...columnMapping,
      [columnName]: {
        ...columnMapping[columnName],
        description: description
      }
    })
  }

  const handleRemoveColumn = (columnName) => {
    const newColumns = columns.filter((col) => col !== columnName)
    const newMapping = { ...columnMapping }
    delete newMapping[columnName]

    setColumns(newColumns)
    setColumnMapping(newMapping)
  }

  const getMediaColumns = () => {
    return Object.entries(columnMapping || {})
      .filter(([_, config]) => config.isMediaColumn)
      .map(([colName, _]) => colName)
  }

  const applyMappingTemplate = (projectId) => {
    if (!projectId) return
    const templateProject = mappingTemplates.find((p) => p.project_id === projectId)
    if (!templateProject || !templateProject.column_mapping) return

    const info = uploadedData.dataFile?.info
    const dataColumns = Array.isArray(info?.columns) && info.columns.length > 0
      ? info.columns
      : columns

    const templateMapping = templateProject.column_mapping || {}
    const filteredMapping = {}

    dataColumns.forEach((col) => {
      if (templateMapping[col]) {
        filteredMapping[col] = templateMapping[col]
      }
    })

    setColumns(dataColumns)
    setColumnMapping(filteredMapping)
  }

  const canProceed = () => {
    // Nếu có media files, cần có ít nhất 1 cột media mapping
    const hasMediaFiles = uploadedData.mediaFiles?.info?.files?.length > 0
    const hasMediaMapping = getMediaColumns().length > 0

    if (mode === 'labeling') {
      // Labeling: không bắt buộc phải có cột label/class sẵn trong file input
      // Chỉ cần media mapping nếu có media files
      return !hasMediaFiles || hasMediaMapping
    }

    // QA: bắt buộc có ít nhất 1 cột label/class để đối chiếu
    const hasLabel = Object.values(columnMapping || {}).some(
      (config) => config.type === 'label' || config.type === 'class'
    )

    return hasLabel && (!hasMediaFiles || hasMediaMapping)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Bước 1.5: Cấu Hình Cột Dữ Liệu
        </h2>
        <p className="text-gray-600">
          Giúp AI hiểu ý nghĩa từng cột trong Excel và cách mapping với media files
        </p>
      </div>

      {/* Thông tin tổng quan */}
      <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <Info className="w-5 h-5 text-primary-600 mt-0.5" />
          <div>
            <h3 className="font-medium text-primary-900">Tại sao cần cấu hình?</h3>
            <p className="text-sm text-primary-700 mt-1">
              AI cần hiểu ý nghĩa từng cột để có thể kiểm tra chất lượng data một cách chính xác. 
              Ví dụ: cột nào là label chính, cột nào chứa tên file media để mapping.
            </p>
          </div>
        </div>
      </div>

      {/* Preview Data */}
      {uploadedData.dataFile?.info?.preview && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-6">
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center">
              <FileText className="w-5 h-5 mr-2" />
              Preview Data (5 dòng đầu)
            </h3>
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {columns.map((column, index) => (
                    <th
                      key={column}
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      <div className="flex flex-col">
                        <span className="font-mono text-sm text-gray-900">{column}</span>
                        <span className="text-xs text-gray-400">Cột {index + 1}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {uploadedData.dataFile.info.preview.slice(0, 5).map((row, rowIndex) => (
                  <tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    {columns.map((column) => (
                      <td key={column} className="px-4 py-3 text-sm text-gray-900 max-w-xs">
                        <div className="truncate" title={String(row[column] || '')}>
                          {row[column] !== null && row[column] !== undefined 
                            ? String(row[column]) 
                            : <span className="text-gray-400 italic">null</span>
                          }
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
            <p className="text-sm text-gray-600">
              📊 Tổng cộng: <strong>{uploadedData.dataFile.info.rows} dòng</strong> × <strong>{columns.length} cột</strong>
            </p>
          </div>
        </div>
      )}

      {/* Danh sách cột + cấu hình output (Labeling) */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <div className="flex justify-between items-start space-x-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                <Table className="w-5 h-5 mr-2" />
                Cấu Hình Các Cột ({columns.length} cột)
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                Xem preview data ở trên để hiểu ý nghĩa từng cột
              </p>
            </div>

            <div className="flex flex-col items-end space-y-2">
              {visibleMappingTemplates.length > 0 && (
                <select
                  defaultValue=""
                  onChange={(e) => applyMappingTemplate(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="">
                    {mode === 'labeling'
                      ? 'Dùng mapping từ project Label data...'
                      : 'Dùng mapping từ project QA data...'}
                  </option>
                  {visibleMappingTemplates.map((p) => (
                    <option key={p.project_id} value={p.project_id}>
                      {p.name || p.project_id}
                    </option>
                  ))}
                </select>
              )}

              <button
                onClick={() => {
                  const defaultMapping = {}
                  const info = uploadedData.dataFile.info
                  const preview = info.preview || []

                  info.columns.forEach((col) => {
                    const sampleData = preview.length > 0 ? preview[0][col] : null
                    const detectedType = autoDetectColumnType(col, sampleData)

                    defaultMapping[col] = {
                      type: detectedType,
                      description: '',
                      isMediaColumn: detectedType === 'media_path' || detectedType === 'media_name'
                    }
                  })
                  setColumnMapping(defaultMapping)
                }}
                className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                🤖 Auto Detect
              </button>
            </div>
          </div>

          {/* Cấu hình cột output cho Labeling (bên trong card cấu hình cột) */}
          {mode === 'labeling' && (
            <div className="mt-4 bg-purple-50 border border-purple-200 rounded-md p-3 space-y-2">
              <div className="flex items-start space-x-2">
                <Tag className="w-4 h-4 text-purple-600 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-purple-900">Cấu hình cột Output (Label mới)</h3>
                  <p className="text-xs text-purple-700 mt-1">
                    Khai báo các cột output mong muốn (ví dụ: <code>tag</code>, <code>cate1</code>, <code>cate2</code>). 
                    Đây là các khóa trong object <code>labels</code> mà AI sẽ trả về và được export thành cột <code>Label_*</code> trong Excel.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {(outputConfig || []).map((out, index) => (
                  <div
                    key={index}
                    className="flex items-start space-x-3 bg-white border border-purple-100 rounded-md p-2"
                  >
                    <div className="w-40">
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Tên khóa (key)
                      </label>
                      <input
                        type="text"
                        value={out.key || ''}
                        onChange={(e) => {
                          if (!setOutputConfig) return
                          const next = [...outputConfig]
                          next[index] = {
                            ...next[index],
                            key: e.target.value.trim()
                          }
                          setOutputConfig(next)
                        }}
                        placeholder="Ví dụ: tag, cate1, cate2"
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                    </div>

                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Mô tả (tùy chọn)
                      </label>
                      <input
                        type="text"
                        value={out.description || ''}
                        onChange={(e) => {
                          if (!setOutputConfig) return
                          const next = [...outputConfig]
                          next[index] = {
                            ...next[index],
                            description: e.target.value
                          }
                          setOutputConfig(next)
                        }}
                        placeholder="Ví dụ: Tag chính, Loại giấy tờ cấp 1, ..."
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (!setOutputConfig) return
                        const next = [...outputConfig]
                        next.splice(index, 1)
                        setOutputConfig(next)
                      }}
                      className="mt-5 px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50"
                    >
                      Xóa
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => {
                    if (!setOutputConfig) return
                    const next = Array.isArray(outputConfig) ? [...outputConfig] : []
                    next.push({ key: '', description: '' })
                    setOutputConfig(next)
                  }}
                  className="mt-1 inline-flex items-center px-3 py-1.5 border border-dashed border-purple-400 text-xs font-medium text-purple-700 rounded hover:bg-purple-50"
                >
                  + Thêm cột output
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="divide-y divide-gray-200">
          {columns.map((columnName, index) => (
            <div key={columnName} className="p-6">
              <div className="flex items-start space-x-4">
                {/* Tên cột */}
                <div className="flex-shrink-0 w-48">
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    Cột {index + 1}
                  </label>
                  <div className="px-3 py-2 bg-gray-100 rounded-md">
                    <code className="text-sm font-mono text-gray-800">{columnName}</code>
                  </div>
                </div>

                {/* Loại cột */}
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Loại cột
                  </label>
                  <select
                    value={columnMapping[columnName]?.type || 'other'}
                    onChange={(e) => handleColumnTypeChange(columnName, e.target.value)}
                    className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                      columnMapping[columnName]?.type !== 'other' 
                        ? 'border-green-300 bg-green-50' 
                        : 'border-gray-300'
                    }`}
                  >
                    {columnTypes.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.icon} {type.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs text-gray-500">
                      {columnTypes.find(t => t.value === columnMapping[columnName]?.type)?.description}
                    </p>
                    {columnMapping[columnName]?.type !== 'other' && (
                      <span className="text-xs text-green-600 font-medium">✨ Auto-detected</span>
                    )}
                  </div>
                </div>

                {/* Mô tả tùy chỉnh */}
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Mô tả chi tiết (tùy chọn)
                  </label>
                  <textarea
                    value={columnMapping[columnName]?.description || ''}
                    onChange={(e) => handleDescriptionChange(columnName, e.target.value)}
                    placeholder="Mô tả ý nghĩa cụ thể của cột này..."
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 text-sm"
                  />
                </div>

                <div className="flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => handleRemoveColumn(columnName)}
                    className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded-md hover:bg-red-50"
                  >
                    Xóa
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Media Mapping Summary */}
      {uploadedData.mediaFiles?.info?.files?.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <Image className="w-5 h-5 text-green-600 mt-0.5" />
            <div>
              <h3 className="font-medium text-green-900">Media Files Mapping</h3>
              <p className="text-sm text-green-700 mt-1">
                Đã phát hiện {uploadedData.mediaFiles.info.files.length} media files. 
                {getMediaColumns().length > 0 ? (
                  <>
                    <br />✅ Các cột mapping: <strong>{getMediaColumns().join(', ')}</strong>
                  </>
                ) : (
                  <>
                    <br />⚠️ Cần chọn ít nhất 1 cột để mapping với media files
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-6">
        <button
          onClick={onBack}
          className="px-6 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          Quay lại
        </button>
        
        <button
          onClick={onNext}
          disabled={!canProceed()}
          className={`px-6 py-2 rounded-md shadow-sm text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 ${
            canProceed()
              ? 'bg-primary-600 text-white hover:bg-primary-700'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          Tiếp tục
        </button>
      </div>

      {!canProceed() && (
        <div className="text-sm text-red-600 text-center">
          {mode === 'qa' &&
            !Object.values(columnMapping || {}).some(
              (config) => config.type === 'label' || config.type === 'class'
            ) &&
            '⚠️ Cần chọn ít nhất 1 cột làm Label/Class'}
          {uploadedData.mediaFiles?.info?.files?.length > 0 && getMediaColumns().length === 0 &&
            ' • Cần chọn cột để mapping với media files'}
        </div>
      )}
    </div>
  )
}

export default ColumnMapping
