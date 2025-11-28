/**
 * Component xử lý upload file
 * Bao gồm: Data Excel, Guideline, Media files
 */

import React, { useState, useRef, useEffect } from 'react'
import { Upload, File, CheckCircle, AlertCircle, FolderOpen } from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import axios from 'axios'

const UploadSection = ({ uploadedData, setUploadedData, onNext, mode = 'qa' }) => {
  const folderInputRef = useRef(null)
  const [uploading, setUploading] = useState({
    data: false,
    guideline: false,
    media: false
  })

  // Reuse file data/guideline/media từ project đã lưu
  const applyProjectFiles = async (projectId) => {
    if (!projectId) return
    try {
      const response = await axios.get(`/api/projects/${projectId}`)
      const project = response.data?.project
      if (!project) return

      const nextUploaded = { ...uploadedData }

      if (project.data_info) {
        nextUploaded.dataFile = {
          file: null,
          info: {
            file_id: project.data_info.file_id,
            file_name: project.data_info.file_name,
            rows: project.data_info.rows,
            columns: project.data_info.columns || [],
            preview: project.data_info.preview || []
          }
        }
      }

      if (project.guideline_info) {
        nextUploaded.guidelineFile = {
          file: null,
          info: {
            file_id: project.guideline_info.file_id,
            file_name: project.guideline_info.file_name
          }
        }
      } else {
        nextUploaded.guidelineFile = null
      }

      if (project.media_info) {
        const hasFilesList = Array.isArray(project.media_info.files) && project.media_info.files.length > 0
        const fileCount = project.media_info.file_count || (hasFilesList ? project.media_info.files.length : 0)
        const infoFiles = hasFilesList
          ? project.media_info.files
          : Array(fileCount)
              .fill(null)
              .map((_, i) => ({ name: `file_${i}` }))

        nextUploaded.mediaFiles = {
          files: [],
          info: {
            batch_id: project.media_info.batch_id,
            files: infoFiles
          }
        }
      } else {
        nextUploaded.mediaFiles = null
      }

      setUploadedData(nextUploaded)
    } catch (err) {
      console.error('[ERROR] Failed to apply project files in UploadSection:', err)
      alert('Lỗi khi dùng lại file từ project. Vui lòng thử lại hoặc upload file mới.')
    }
  }
  
  const [errors, setErrors] = useState({})
  const [projectOptions, setProjectOptions] = useState([])
  const [loadingProjects, setLoadingProjects] = useState(false)

  // Load danh sách projects để cho phép reuse file data/guideline/media
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        setLoadingProjects(true)
        const response = await axios.get('/api/projects')
        setProjectOptions(response.data?.projects || [])
      } catch (err) {
        console.error('[ERROR] Failed to load projects for reuse in UploadSection:', err)
      } finally {
        setLoadingProjects(false)
      }
    }

    fetchProjects()
  }, [])

  // Upload Data File
  const uploadDataFile = async (file) => {
    setUploading({ ...uploading, data: true })
    setErrors({ ...errors, data: null })
    
    const formData = new FormData()
    formData.append('file', file)
    
    try {
      const response = await axios.post('/api/upload/data', formData, {
        headers: { 
          'Content-Type': 'multipart/form-data',
          'Accept': 'application/json'
        }
      })
      
      console.log('[DEBUG] Response type:', typeof response.data)
      console.log('[DEBUG] Is string?', typeof response.data === 'string')
      
      // Nếu response.data là string, parse lại
      let parsedData = response.data
      if (typeof response.data === 'string') {
        console.log('[DEBUG] Parsing string response...')
        console.log('[DEBUG] String length:', response.data.length)
        console.log('[DEBUG] First 200 chars:', response.data.substring(0, 200))
        try {
          parsedData = JSON.parse(response.data)
          console.log('[DEBUG] Parse successful!')
        } catch (parseError) {
          console.error('[ERROR] JSON parse failed:', parseError)
          console.error('[ERROR] Response data:', response.data)
          throw new Error('Không thể parse response từ server')
        }
      }
      
      console.log('[DEBUG] Parsed data:', parsedData)
      console.log('[DEBUG] Rows:', parsedData.rows)
      console.log('[DEBUG] Columns:', parsedData.columns)
      console.log('[DEBUG] Columns length:', parsedData.columns?.length)
      
      // Đảm bảo data có đúng format
      const dataInfo = {
        file_id: parsedData.file_id,
        rows: parsedData.rows,
        columns: parsedData.columns,
        preview: parsedData.preview,
        success: parsedData.success,
        message: parsedData.message
      }
      
      console.log('[DEBUG] Final dataInfo:', dataInfo)
      console.log('[DEBUG] Final rows:', dataInfo.rows)
      console.log('[DEBUG] Final columns length:', dataInfo.columns?.length)
      
      setUploadedData({
        ...uploadedData,
        dataFile: {
          file,
          info: dataInfo
        }
      })
    } catch (error) {
      setErrors({ ...errors, data: error.response?.data?.error || 'Lỗi upload file' })
    } finally {
      setUploading({ ...uploading, data: false })
    }
  }

  // Upload Guideline File
  const uploadGuidelineFile = async (file) => {
    setUploading({ ...uploading, guideline: true })
    setErrors({ ...errors, guideline: null })
    
    const formData = new FormData()
    formData.append('file', file)
    
    try {
      const response = await axios.post('/api/upload/guideline', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      
      setUploadedData({
        ...uploadedData,
        guidelineFile: {
          file,
          info: response.data
        }
      })
    } catch (error) {
      setErrors({ ...errors, guideline: error.response?.data?.error || 'Lỗi upload file' })
    } finally {
      setUploading({ ...uploading, guideline: false })
    }
  }

  // Upload Media Files theo batch
  const uploadMediaFiles = async (files) => {
    setUploading({ ...uploading, media: true })
    setErrors({ ...errors, media: null })
    
    const BATCH_SIZE = 50 // Upload 50 files mỗi lần
    const totalFiles = files.length
    let uploadedCount = 0
    let allResponses = []
    
    console.log(`[INFO] Bắt đầu upload ${totalFiles} files theo batch (${BATCH_SIZE} files/batch)`)
    
    try {
      // Chia files thành các batch
      for (let i = 0; i < totalFiles; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE)
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1
        const totalBatches = Math.ceil(totalFiles / BATCH_SIZE)
        
        console.log(`[INFO] Đang upload batch ${batchNumber}/${totalBatches} (${batch.length} files)`)
        
        const formData = new FormData()
        batch.forEach(file => {
          formData.append('files', file)
        })
        
        const response = await axios.post('/api/upload/media', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 60000 // 60 seconds timeout
        })
        
        allResponses.push(response.data)
        uploadedCount += batch.length
        
        console.log(`[SUCCESS] Batch ${batchNumber} hoàn thành. Đã upload ${uploadedCount}/${totalFiles} files`)
      }
      
      // Kết hợp tất cả responses
      const combinedResponse = {
        success: true,
        message: `Upload thành công ${totalFiles} media files`,
        batch_id: allResponses[0]?.batch_id || 'unknown',
        files: allResponses.flatMap(r => r.files || []),
        total_files: totalFiles
      }
      
      setUploadedData({
        ...uploadedData,
        mediaFiles: {
          files,
          info: combinedResponse
        }
      })
      
      console.log(`[SUCCESS] Hoàn thành upload ${totalFiles} files!`)
      
    } catch (error) {
      console.error('[ERROR] Lỗi upload media:', error)
      setErrors({ ...errors, media: `Lỗi upload files (đã upload ${uploadedCount}/${totalFiles}): ${error.message}` })
    } finally {
      setUploading({ ...uploading, media: false })
    }
  }

  // Xử lý chọn folder
  const handleFolderSelect = (event) => {
    const files = Array.from(event.target.files)
    if (files.length > 0) {
      console.log(`[INFO] Đã chọn ${files.length} files từ folder`)
      uploadMediaFiles(files)
    }
  }

  // Dropzone cho Data File
  const dataDropzone = useDropzone({
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv']
    },
    maxFiles: 1,
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        uploadDataFile(acceptedFiles[0])
      }
    }
  })

  // Dropzone cho Guideline File
  const guidelineDropzone = useDropzone({
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/msword': ['.doc'],
      'text/plain': ['.txt']
    },
    maxFiles: 1,
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        uploadGuidelineFile(acceptedFiles[0])
      }
    }
  })

  // Dropzone cho Media Files
  const mediaDropzone = useDropzone({
    accept: {
      'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'],
      'audio/*': ['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'],
      'video/*': ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm']
    },
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        uploadMediaFiles(acceptedFiles)
      }
    }
  })

  const canProceed = uploadedData.dataFile && uploadedData.guidelineFile

  // Lọc project theo loại để reuse cho đúng flow
  const filteredProjectOptions = React.useMemo(() => {
    if (!projectOptions || projectOptions.length === 0) return []

    if (mode === 'labeling') {
      // Chỉ dùng lại project thuộc Xử lý data
      return projectOptions.filter(p => p.project_type === 'labeling')
    }

    // mode QA: chỉ reuse project QA (hoặc project cũ chưa có project_type)
    return projectOptions.filter(p => !p.project_type || p.project_type === 'qa')
  }, [projectOptions, mode])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Bước 1: Upload Dữ Liệu
        </h2>
        <p className="text-gray-600">
          {mode === 'labeling'
            ? 'Upload file data Excel và guideline để bắt đầu quá trình Labeling (Label data)'
            : 'Upload file data Excel và guideline để bắt đầu quá trình QA'}
        </p>
      </div>

      {/* Reuse files từ project đã lưu cùng loại */}
      {filteredProjectOptions.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col md:flex-row md:items-center md:justify-between space-y-3 md:space-y-0">
          <div>
            <p className="text-sm font-medium text-gray-700">
              {mode === 'labeling'
                ? 'Hoặc dùng lại file Data/Guideline/Media từ project Label data đã lưu:'
                : 'Hoặc dùng lại file Data/Guideline/Media từ project QA data đã lưu:'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Khi chọn project, hệ thống sẽ reuse dữ liệu đã parse sẵn, không cần upload lại file.
            </p>
          </div>
          <select
            defaultValue=""
            onChange={(e) => applyProjectFiles(e.target.value)}
            className="w-full md:w-72 px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">
              {loadingProjects ? 'Đang tải danh sách projects...' : 'Chọn project...'}
            </option>
            {filteredProjectOptions.map((p) => (
              <option key={p.project_id} value={p.project_id}>
                {p.name || p.project_id}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Upload Data File */}
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-primary-500 transition-colors">
        <div className="flex items-start space-x-4">
          <div className="flex-shrink-0">
            <File className="w-8 h-8 text-primary-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              File Data (Excel)
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Upload file Excel chứa data cần kiểm tra (hỗ trợ .xlsx, .xls, .csv)
            </p>
            
            {!uploadedData.dataFile ? (
              <div
                {...dataDropzone.getRootProps()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary-500 hover:bg-primary-50 transition-all"
              >
                <input {...dataDropzone.getInputProps()} />
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">
                  {uploading.data ? 'Đang upload...' : 'Kéo thả file vào đây hoặc click để chọn'}
                </p>
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <CheckCircle className="w-6 h-6 text-green-600" />
                  <div>
                    <p className="font-medium text-green-900">
                      {uploadedData.dataFile.file?.name || uploadedData.dataFile.info?.file_name}
                    </p>
                    <p className="text-sm text-green-700">
                      {uploadedData.dataFile.info.rows} dòng, {Array.isArray(uploadedData.dataFile.info.columns) ? uploadedData.dataFile.info.columns.length : 0} cột
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setUploadedData({ ...uploadedData, dataFile: null })}
                  className="text-red-600 hover:text-red-800"
                >
                  Xóa
                </button>
              </div>
            )}
            
            {errors.data && (
              <div className="mt-2 flex items-center space-x-2 text-red-600">
                <AlertCircle className="w-5 h-5" />
                <span className="text-sm">{errors.data}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Upload Guideline File */}
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-primary-500 transition-colors">
        <div className="flex items-start space-x-4">
          <div className="flex-shrink-0">
            <File className="w-8 h-8 text-primary-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              File Guideline
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Upload guideline (hỗ trợ .pdf, .xlsx, .docx, .txt)
            </p>
            
            {!uploadedData.guidelineFile ? (
              <div
                {...guidelineDropzone.getRootProps()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary-500 hover:bg-primary-50 transition-all"
              >
                <input {...guidelineDropzone.getInputProps()} />
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">
                  {uploading.guideline ? 'Đang upload...' : 'Kéo thả file vào đây hoặc click để chọn'}
                </p>
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <CheckCircle className="w-6 h-6 text-green-600" />
                  <div>
                    <p className="font-medium text-green-900">
                      {uploadedData.guidelineFile.file?.name || uploadedData.guidelineFile.info?.file_name}
                    </p>
                    <p className="text-sm text-green-700">Đã upload thành công</p>
                  </div>
                </div>
                <button
                  onClick={() => setUploadedData({ ...uploadedData, guidelineFile: null })}
                  className="text-red-600 hover:text-red-800"
                >
                  Xóa
                </button>
              </div>
            )}
            
            {errors.guideline && (
              <div className="mt-2 flex items-center space-x-2 text-red-600">
                <AlertCircle className="w-5 h-5" />
                <span className="text-sm">{errors.guideline}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Upload Media Files (Optional) */}
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-primary-500 transition-colors">
        <div className="flex items-start space-x-4">
          <div className="flex-shrink-0">
            <FolderOpen className="w-8 h-8 text-primary-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Media Files (Tùy chọn)
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Upload các file media nếu data có kèm theo (audio, image, video)
            </p>
            
            {!uploadedData.mediaFiles ? (
              <div className="space-y-4">
                {/* Dropzone cho chọn files */}
                <div
                  {...mediaDropzone.getRootProps()}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary-500 hover:bg-primary-50 transition-all"
                >
                  <input {...mediaDropzone.getInputProps()} />
                  <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">
                    {uploading.media ? 'Đang upload...' : 'Kéo thả files vào đây hoặc click để chọn nhiều file'}
                  </p>
                </div>
                
                {/* Nút chọn folder */}
                <div className="text-center">
                  <p className="text-sm text-gray-500 mb-2">Hoặc</p>
                  <input
                    type="file"
                    ref={folderInputRef}
                    webkitdirectory=""
                    directory=""
                    multiple
                    onChange={handleFolderSelect}
                    className="hidden"
                  />
                  <button
                    onClick={() => folderInputRef.current?.click()}
                    disabled={uploading.media}
                    className="inline-flex items-center px-4 py-2 border border-primary-300 rounded-md shadow-sm text-sm font-medium text-primary-700 bg-white hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                  >
                    <FolderOpen className="w-4 h-4 mr-2" />
                    Chọn Folder
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <CheckCircle className="w-6 h-6 text-green-600" />
                  <div>
                    <p className="font-medium text-green-900">
                      {uploadedData.mediaFiles.info?.files?.length || 0} files
                    </p>
                    <p className="text-sm text-green-700">Đã upload thành công</p>
                  </div>
                </div>
                <button
                  onClick={() => setUploadedData({ ...uploadedData, mediaFiles: null })}
                  className="text-red-600 hover:text-red-800"
                >
                  Xóa
                </button>
              </div>
            )}
            
            {errors.media && (
              <div className="mt-2 flex items-center space-x-2 text-red-600">
                <AlertCircle className="w-5 h-5" />
                <span className="text-sm">{errors.media}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Next Button */}
      <div className="flex justify-end">
        <button
          onClick={onNext}
          disabled={!canProceed}
          className={`px-6 py-3 rounded-lg font-semibold transition-all ${
            canProceed
              ? 'bg-primary-600 text-white hover:bg-primary-700 shadow-lg hover:shadow-xl'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          Tiếp theo →
        </button>
      </div>
    </div>
  )
}

export default UploadSection
