/**
 * Component tạo project metadata sau khi upload data
 * Cho phép người dùng đặt tên và mô tả project để lưu vào danh sách
 */

import React, { useState } from 'react'
import { FolderPlus, FileText, Calendar, User, Save } from 'lucide-react'
import axios from 'axios'

const ProjectCreation = ({ uploadedData, projectData, setProjectData, onNext, onBack, projectType = 'qa' }) => {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [currentUser, setCurrentUser] = useState(null)

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem('spd_current_user')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && parsed.username) {
          setCurrentUser(parsed)
        }
      }
    } catch (e) {
      // ignore
    }
  }, [])

  // Auto-generate project name if empty
  const generateProjectName = () => {
    const now = new Date()
    const dateStr = now.toLocaleDateString('vi-VN')
    const timeStr = now.toLocaleTimeString('vi-VN', { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
    
    const isLabeling = projectType === 'labeling'
    let baseName = isLabeling ? 'Labeling Project' : 'QA Project'
    const fileName = uploadedData.dataFile?.file?.name || uploadedData.dataFile?.info?.file_name
    if (fileName) {
      const cleanName = fileName.replace(/\.[^/.]+$/, "")
      baseName = `${isLabeling ? 'Label' : 'QA'} ${cleanName}`
    }
    
    return `${baseName} - ${dateStr} ${timeStr}`
  }

  // Handle form changes
  const handleChange = (field, value) => {
    setProjectData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  // Save project metadata
  const saveProject = async () => {
    if (!projectData.name?.trim()) {
      setError('Vui lòng nhập tên project')
      return
    }

    if (!currentUser) {
      setError('Không xác định được user hiện tại, vui lòng đăng nhập lại.')
      return
    }

    const role = (currentUser.role || '').toLowerCase()
    const isOwner = role === 'owner'
    const perms = currentUser.permissions || []
    const canCreate = isOwner || perms.includes('create_project')
    if (!canCreate) {
      setError('Bạn không có quyền tạo project.')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const projectInfo = {
        name: projectData.name.trim(),
        description: projectData.description?.trim() || '',
        created_by: projectData.created_by?.trim() || 'Anonymous',
        project_type: projectType || 'qa',
        data_info: {
          file_id: uploadedData.dataFile?.info?.file_id,
          file_name: uploadedData.dataFile?.file?.name || uploadedData.dataFile?.info?.file_name,
          rows: uploadedData.dataFile?.info?.rows,
          columns: uploadedData.dataFile?.info?.columns?.length || 0
        },
        guideline_info: uploadedData.guidelineFile ? {
          file_id: uploadedData.guidelineFile.info?.file_id,
          file_name: uploadedData.guidelineFile.file?.name || uploadedData.guidelineFile.info?.file_name
        } : null,
        media_info: uploadedData.mediaFiles ? {
          batch_id: uploadedData.mediaFiles.info?.batch_id,
          file_count: uploadedData.mediaFiles.info?.files?.length || 0,
          files: uploadedData.mediaFiles.info?.files || []
        } : null,
        created_at: new Date().toISOString()
      }

      const response = await axios.post('/api/projects/create', projectInfo, {
        headers: {
          'X-Current-User': currentUser.username
        }
      })
      
      // Update project data with server response
      setProjectData(prev => ({
        ...prev,
        project_id: response.data.project_id,
        saved: true
      }))

      onNext()
    } catch (err) {
      setError(err.response?.data?.error || 'Lỗi khi lưu project')
    } finally {
      setSaving(false)
    }
  }

  // Initialize project name if empty
  React.useEffect(() => {
    if (!projectData.name) {
      handleChange('name', generateProjectName())
    }
    
    // Debug: Log uploaded data structure
    console.log('[DEBUG] Uploaded data structure:', uploadedData)
  }, [uploadedData])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Tạo Project
        </h2>
        <p className="text-gray-600">
          Đặt tên và mô tả cho project để dễ quản lý và tìm kiếm sau này
        </p>
      </div>

      {/* Project Summary */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-4 flex items-center">
          <FileText className="w-5 h-5 mr-2" />
          Tóm tắt dữ liệu đã upload
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Data File */}
          <div className="bg-white p-4 rounded-lg">
            <div className="text-sm font-medium text-gray-700 mb-1">📊 Data File</div>
            <div className="text-sm text-gray-900 font-mono">
              {uploadedData.dataFile?.file?.name || uploadedData.dataFile?.info?.file_name || 'Chưa upload'}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {uploadedData.dataFile?.info?.rows ? (
                `${uploadedData.dataFile.info.rows.toLocaleString()} dòng × ${uploadedData.dataFile.info.columns?.length || 0} cột`
              ) : (
                'Chưa có thông tin'
              )}
            </div>
          </div>

          {/* Guideline File */}
          <div className="bg-white p-4 rounded-lg">
            <div className="text-sm font-medium text-gray-700 mb-1">📋 Guideline</div>
            <div className="text-sm text-gray-900 font-mono">
              {uploadedData.guidelineFile?.file?.name || uploadedData.guidelineFile?.info?.file_name || 'Chưa upload'}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {uploadedData.guidelineFile ? (
                <span className="text-green-600">✓ Đã sẵn sàng</span>
              ) : (
                <span className="text-gray-400">Tùy chọn</span>
              )}
            </div>
          </div>

          {/* Media Files */}
          <div className="bg-white p-4 rounded-lg">
            <div className="text-sm font-medium text-gray-700 mb-1">🎬 Media Files</div>
            <div className="text-sm text-gray-900 font-mono">
              {uploadedData.mediaFiles?.info?.files?.length ? (
                `${uploadedData.mediaFiles.info.files.length.toLocaleString()} files`
              ) : (
                'Chưa upload'
              )}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {uploadedData.mediaFiles?.info?.files?.length ? (
                <span className="text-green-600">✓ Đã upload</span>
              ) : (
                <span className="text-gray-400">Không có</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Project Form */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <FolderPlus className="w-5 h-5 mr-2" />
          Thông tin Project
        </h3>

        <div className="space-y-4">
          {/* Project Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tên Project *
            </label>
            <input
              type="text"
              value={projectData.name || ''}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="Nhập tên project..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              Tên này sẽ hiển thị trong danh sách projects
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Mô tả (tùy chọn)
            </label>
            <textarea
              value={projectData.description || ''}
              onChange={(e) => handleChange('description', e.target.value)}
              placeholder="Mô tả mục đích, nội dung của project..."
              rows={3}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Created By */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Người tạo
            </label>
            <input
              type="text"
              value={projectData.created_by || ''}
              onChange={(e) => handleChange('created_by', e.target.value)}
              placeholder="Tên người tạo project..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Auto-generated info */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex items-center text-sm text-gray-600 mb-2">
              <Calendar className="w-4 h-4 mr-2" />
              <span>Thời gian tạo: {new Date().toLocaleString('vi-VN')}</span>
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <User className="w-4 h-4 mr-2" />
              <span>ID sẽ được tự động tạo khi lưu</span>
            </div>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-3 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 transition-all"
        >
          ← Quay lại
        </button>

        <button
          onClick={saveProject}
          disabled={saving || !projectData.name?.trim()}
          className={`px-6 py-3 rounded-lg font-semibold transition-all flex items-center space-x-2 ${
            saving || !projectData.name?.trim()
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-primary-600 text-white hover:bg-primary-700 shadow-lg hover:shadow-xl'
          }`}
        >
          {saving ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Đang lưu...</span>
            </>
          ) : (
            <>
              <Save className="w-5 h-5" />
              <span>Lưu và tiếp tục →</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}

export default ProjectCreation
