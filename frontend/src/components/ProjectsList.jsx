/**
 * Component hiển thị danh sách các project QA đã thực hiện
 */

import React, { useState, useEffect } from 'react'
import { Folder, Calendar, FileText, Download, Loader, RefreshCw, Play, Trash2, Eye } from 'lucide-react'
import axios from 'axios'

const ProjectsList = ({ onOpenProject, filterType, onFilterChange }) => {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  // filterType được control từ App qua props
  const [searchTerm, setSearchTerm] = useState('')
  const [currentUser, setCurrentUser] = useState(null)

  useEffect(() => {
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

  // Load projects
  const loadProjects = async () => {
    setLoading(true)
    try {
      console.log('[DEBUG] Loading projects...')
      const response = await axios.get('/api/projects')
      console.log('[DEBUG] Projects response:', response.data)
      setProjects(response.data.projects)
      console.log('[DEBUG] Projects set:', response.data.projects)
    } catch (err) {
      console.error('Error loading projects:', err)
    } finally {
      setLoading(false)
    }
  }

  const normalizedSearch = searchTerm.trim().toLowerCase()
  const userRole = (currentUser?.role || '').toLowerCase()
  const isOwner = userRole === 'owner'
  const userPermissions = currentUser?.permissions || []
  const hasPermission = (code) => {
    if (!currentUser) return false
    if (isOwner) return true
    return userPermissions.includes(code)
  }
  const canDeleteProjects = currentUser && hasPermission('delete_project')

  // Áp dụng filter + search trước khi group
  const visibleProjects = projects.filter((p) => {
    // Filter theo loại project
    const type = p.project_type || 'qa'
    if (filterType === 'qa' && type !== 'qa') return false
    if (filterType === 'labeling' && type !== 'labeling') return false
    if (filterType === 'compare' && type !== 'compare') return false

    // Filter theo search
    if (!normalizedSearch) return true
    const name = (p.name || '').toLowerCase()
    const desc = (p.description || '').toLowerCase()
    const id = (p.project_id || '').toLowerCase()
    return (
      name.includes(normalizedSearch) ||
      desc.includes(normalizedSearch) ||
      id.includes(normalizedSearch)
    )
  })

  useEffect(() => {
    loadProjects()
  }, [])

  // Open project (load project data and switch to workflow)
  const openProject = async (projectId) => {
    try {
      const response = await axios.get(`/api/projects/${projectId}`)
      const project = response.data.project
      
      console.log('Opening project:', project)
      
      // Reconstruct uploadedData from project info
      const uploadedData = {
        dataFile: {
          info: {
            file_id: project.data_info?.file_id,
            file_name: project.data_info?.file_name,
            rows: project.data_info?.rows,
            columns: project.data_info?.columns || [],
            preview: project.data_info?.preview || []
          }
        },
        guidelineFile: project.guideline_info ? {
          info: {
            file_id: project.guideline_info.file_id,
            file_name: project.guideline_info.file_name
          }
        } : null,
        mediaFiles: project.media_info ? {
          info: {
            batch_id: project.media_info.batch_id,
            files: Array(project.media_info.file_count).fill(null).map((_, i) => ({ name: `file_${i}` }))
          }
        } : null
      }

      // Call parent callback to load project and switch to workflow
      if (onOpenProject) {
        onOpenProject({
          project: project,
          uploadedData: uploadedData
        })
      }
    } catch (err) {
      console.error('Error opening project:', err)
      alert('Lỗi khi mở project')
    }
  }

  // Delete project
  const deleteProject = async (projectId, projectName) => {
    if (!currentUser || !hasPermission('delete_project')) {
      alert('Bạn không có quyền xóa project.')
      return
    }

    if (!confirm(`Bạn có chắc muốn xóa project "${projectName}"?`)) {
      return
    }

    try {
      await axios.delete(`/api/projects/${projectId}`, {
        headers: {
          'X-Current-User': currentUser.username
        }
      })
      // Reload projects list
      loadProjects()
      alert('Đã xóa project thành công')
    } catch (err) {
      console.error('Error deleting project:', err)
      alert('Lỗi khi xóa project')
    }
  }

  // View project details
  const viewProject = async (projectId) => {
    try {
      const response = await axios.get(`/api/projects/${projectId}`)
      const project = response.data.project
      
      // Show project details in modal or new page
      console.log('Project details:', project)
      alert(`Project: ${project.name}\nMô tả: ${project.description}\nTạo bởi: ${project.created_by}\nThời gian: ${new Date(project.created_at).toLocaleString('vi-VN')}`)
    } catch (err) {
      console.error('Error viewing project:', err)
      alert('Lỗi khi xem chi tiết project')
    }
  }

  // Export project
  const exportProject = async (projectId) => {
    try {
      const response = await axios.get(`/api/projects/${projectId}/export`, {
        responseType: 'blob'
      })

      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `project_${projectId}.xlsx`)
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (err) {
      console.error('Error exporting:', err)
      alert('Chức năng export sẽ được thêm sau')
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader className="w-12 h-12 text-primary-600 animate-spin mb-4" />
        <p className="text-gray-600">Đang tải danh sách projects...</p>
      </div>
    )
  }

  const renderCard = (project, type) => {
    const statusBadgeClass =
      project.status === 'completed'
        ? 'bg-green-100 text-green-800'
        : project.status === 'processing'
        ? 'bg-blue-100 text-blue-800'
        : project.status === 'created'
        ? 'bg-yellow-100 text-yellow-800'
        : 'bg-gray-100 text-gray-800'

    return (
      <div
        key={project.project_id}
        className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center">
              <Folder className="w-6 h-6 text-primary-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">
                {project.name || `Project ${project.project_id?.slice(0, 8)}`}
              </h3>
              {type === 'label' && (
                <span className="inline-block px-2 py-1 text-xs font-medium rounded bg-purple-100 text-purple-800 mr-2">
                  Label data
                </span>
              )}
              {type === 'compare' && (
                <span className="inline-block px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-800 mr-2">
                  Compare data
                </span>
              )}
              <span className={`inline-block px-2 py-1 text-xs font-medium rounded ${statusBadgeClass}`}>
                {project.status === 'completed'
                  ? 'Hoàn thành'
                  : project.status === 'processing'
                  ? 'Đang xử lý'
                  : project.status === 'created'
                  ? 'Đã tạo'
                  : project.status}
              </span>
            </div>
          </div>
        </div>

        {project.description && (
          <p className="text-sm text-gray-600 mb-4">{project.description}</p>
        )}

        <div className="space-y-2 mb-4">
          <div className="flex items-center space-x-2 text-sm text-gray-600">
            <Calendar className="w-4 h-4" />
            <span>{new Date(project.created_at).toLocaleString('vi-VN')}</span>
          </div>

          <div className="flex items-center space-x-2 text-sm text-gray-600">
            <FileText className="w-4 h-4" />
            <span>{project.data_info?.rows || 0} dòng data</span>
          </div>

          {project.created_by && (
            <div className="flex items-center space-x-2 text-sm text-gray-600">
              <span>👤 {project.created_by}</span>
            </div>
          )}
        </div>

        <div className="flex space-x-2">
          <button
            onClick={() => viewProject(project.project_id)}
            className="flex-1 flex items-center justify-center space-x-2 px-3 py-2 bg-white border border-primary-200 text-primary-700 rounded-lg font-medium hover:bg-primary-50 hover:border-primary-300 transition-all"
            title="Xem chi tiết"
          >
            <Eye className="w-4 h-4" />
            <span>Xem</span>
          </button>

          <button
            onClick={() => openProject(project.project_id)}
            className="flex-1 flex items-center justify-center space-x-2 px-3 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-all"
            title="Mở project"
          >
            <Play className="w-4 h-4" />
            <span>Mở</span>
          </button>

          {canDeleteProjects && (
            <button
              onClick={() => deleteProject(project.project_id, project.name)}
              className="px-3 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-all"
              title="Xóa project"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Projects
          </h2>
          <p className="text-gray-600 text-sm">
            Quản lý tất cả project theo 3 nhóm chính:
            <span className="ml-1 font-medium text-primary-700">QA data</span>,
            <span className="ml-1 font-medium text-purple-700">Label data</span> và
            <span className="ml-1 font-medium text-teal-700">Compare data</span>.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          {/* Search */}
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm theo tên / mô tả / ID..."
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />

          {/* Filter type */}
          <div className="flex items-center space-x-1 bg-gray-100 rounded-lg p-1 text-xs font-medium">
            <button
              onClick={() => onFilterChange && onFilterChange('all')}
              className={`px-2 py-1 rounded ${
                filterType === 'all' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'
              }`}
            >
              Tất cả
            </button>
            <button
              onClick={() => onFilterChange && onFilterChange('qa')}
              className={`px-2 py-1 rounded ${
                filterType === 'qa' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'
              }`}
            >
              QA data
            </button>
            <button
              onClick={() => onFilterChange && onFilterChange('labeling')}
              className={`px-2 py-1 rounded ${
                filterType === 'labeling' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'
              }`}
            >
              Label data
            </button>
            <button
              onClick={() => onFilterChange && onFilterChange('compare')}
              className={`px-2 py-1 rounded ${
                filterType === 'compare' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'
              }`}
            >
              Compare data
            </button>
          </div>

          <button
            onClick={loadProjects}
            className="flex items-center space-x-2 px-3 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-all text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {/* Debug info - chỉ hiện khi có lỗi */}
      {projects.length === 0 && !loading && (
        <details className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <summary className="text-sm text-yellow-800 cursor-pointer">
            🐛 Debug Info (click để xem)
          </summary>
          <div className="mt-2">
            <p className="text-sm text-yellow-800">
              <strong>Loading:</strong> {loading.toString()}, <strong>Projects count:</strong> {projects.length}
            </p>
          </div>
        </details>
      )}

      {projects.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <Folder className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 text-lg">Chưa có project nào</p>
          <p className="text-gray-500 text-sm mt-2">
            Bắt đầu một QA data mới hoặc một flow Label data để tạo project đầu tiên
          </p>
        </div>
      ) : visibleProjects.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-600">
          Không tìm thấy project phù hợp với bộ lọc hiện tại.
        </div>
      ) : (
        <div className="space-y-8">
          {(() => {
            const qaProjects = visibleProjects.filter((p) => (p.project_type || 'qa') === 'qa')
            const labelProjects = visibleProjects.filter((p) => p.project_type === 'labeling')
            const compareProjects = visibleProjects.filter((p) => p.project_type === 'compare')

            if (filterType === 'all') {
              return (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                  {/* QA column */}
                  <div className="bg-primary-50 border border-primary-100 rounded-xl p-4">
                    <h3 className="text-lg font-semibold text-primary-900 mb-3 flex items-baseline justify-between">
                      <span>Projects QA data</span>
                      <span className="text-sm font-medium text-primary-700">{qaProjects.length}</span>
                    </h3>
                    {qaProjects.length === 0 ? (
                      <p className="text-sm text-blue-700/80 italic">Chưa có project QA data nào.</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-4">
                        {qaProjects.map((project) => renderCard(project, 'qa'))}
                      </div>
                    )}
                  </div>

                  {/* Label column */}
                  <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
                    <h3 className="text-lg font-semibold text-purple-900 mb-3 flex items-baseline justify-between">
                      <span>Projects Label data</span>
                      <span className="text-sm font-medium text-purple-700">{labelProjects.length}</span>
                    </h3>
                    {labelProjects.length === 0 ? (
                      <p className="text-sm text-purple-700/80 italic">Chưa có project Label data nào.</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-4">
                        {labelProjects.map((project) => renderCard(project, 'label'))}
                      </div>
                    )}
                  </div>

                  {/* Compare column */}
                  <div className="bg-teal-50 border border-teal-100 rounded-xl p-4">
                    <h3 className="text-lg font-semibold text-teal-900 mb-3 flex items-baseline justify-between">
                      <span>Projects Compare data</span>
                      <span className="text-sm font-medium text-teal-700">{compareProjects.length}</span>
                    </h3>
                    {compareProjects.length === 0 ? (
                      <p className="text-sm text-sky-700/80 italic">Chưa có project Compare data nào.</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-4">
                        {compareProjects.map((project) => renderCard(project, 'compare'))}
                      </div>
                    )}
                  </div>
                </div>
              )
            }

            // Các filter khác (qa/labeling/compare riêng lẻ) giữ layout dọc như cũ
            return (
              <>
                {qaProjects.length > 0 && filterType === 'qa' && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">
                      Projects QA data
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {qaProjects.map((project) => renderCard(project, 'qa'))}
                    </div>
                  </div>
                )}

                {labelProjects.length > 0 && filterType === 'labeling' && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">
                      Projects Label data
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {labelProjects.map((project) => renderCard(project, 'label'))}
                    </div>
                  </div>
                )}

                {compareProjects.length > 0 && filterType === 'compare' && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">
                      Projects Compare data
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {compareProjects.map((project) => renderCard(project, 'compare'))}
                    </div>
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}

export default ProjectsList
