/**
 * Component chính của ứng dụng
 * Quản lý routing và state toàn cục
 */

import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { FileText, Upload, CheckCircle, AlertCircle, Settings } from 'lucide-react'
import UploadSection from './components/UploadSection'
import ProjectCreation from './components/ProjectCreation'
import ColumnMapping from './components/ColumnMapping'
import QAConfiguration from './components/QAConfiguration'
import VerificationSection from './components/VerificationSection'
import ResultsView from './components/ResultsView'
import ProjectsList from './components/ProjectsList'
import LabelWorkflow from './components/LabelWorkflow'
import CompareData from './components/CompareData'
import ManageUsers from './components/ManageUsers'
import AiCardPage from './components/AiCardPage'

// Helper: kiểm tra quyền theo view
const hasPermissionForView = (user, view) => {
  if (!user) return false
  const role = (user.role || '').toLowerCase()
  const isOwner = role === 'owner'
  const perms = user.permissions || []
  const has = (code) => isOwner || perms.includes(code)

  switch (view) {
    case 'workflow':
      return has('access_workflow')
    case 'labeling':
      return has('access_labeling')
    case 'compare':
      return has('access_compare')
    case 'projects':
      return has('access_projects')
    case 'ai-card':
      return has('access_ai_card')
    case 'manage':
      return has('manage_users')
    default:
      return false
  }
}

// Helper: chọn view mặc định phù hợp nhất với quyền của user
const getDefaultViewForUser = (user) => {
  if (!user) return 'workflow'
  const order = ['workflow', 'labeling', 'compare', 'projects', 'ai-card', 'manage']
  for (const v of order) {
    if (hasPermissionForView(user, v)) return v
  }
  // Nếu không có quyền view nào, fallback về workflow (sẽ bị chặn bởi useEffect phía dưới)
  return 'workflow'
}

// Map URL path -> state (currentView, currentStep, projectId, section)
const getStateFromPath = (pathname) => {
  try {
    const raw = pathname || '/'
    const cleaned = raw.replace(/^\/+|\/+$/g, '')
    if (!cleaned) {
      return { view: 'workflow', step: 1 }
    }

    const parts = cleaned.split('/')
    const [first, second, third] = parts

    // QA workflow
    if (!first || first === 'qa') {
      let step = 1
      if (second === 'project') step = 2
      else if (second === 'set-up-column') step = 3
      else if (second === 'qa-config') step = 4
      else if (second === 'verify') step = 5
      else if (second === 'results') step = 6
      const projectId = third || null
      return { view: 'workflow', step, projectId }
    }

    // Label workflow
    if (first === 'label') {
      let labelStep = 1
      if (second === 'project') labelStep = 2
      else if (second === 'set-up-column') labelStep = 3
      else if (second === 'label-config') labelStep = 4
      else if (second === 'results') labelStep = 5
      const projectId = third || null
      return { view: 'labeling', step: labelStep, projectId }
    }

    // Compare
    if (first === 'compare') {
      let section = 'upload'
      let projectId = null
      if (second === 'config') section = 'config'
      else if (second === 'results') {
        section = 'results'
        projectId = third || null
      }
      return { view: 'compare', section, projectId }
    }

    if (first === 'projects') {
      let projectsFilter = 'all'
      if (second === 'qa') projectsFilter = 'qa'
      else if (second === 'label' || second === 'labeling') projectsFilter = 'labeling'
      else if (second === 'compare') projectsFilter = 'compare'
      return { view: 'projects', projectsFilter }
    }
    if (first === 'manage') return { view: 'manage' }
    if (first === 'ai-card') return { view: 'ai-card' }

    // Mặc định fallback về QA step 1
    return { view: 'workflow', step: 1 }
  } catch (e) {
    return { view: 'workflow', step: 1 }
  }
}

// Map state (view, step) -> URL path
const getPathFromState = (view, step, labelStep, compareSection, projectsFilter) => {
  if (view === 'workflow') {
    switch (step) {
      case 2:
        return '/qa/project'
      case 3:
        return '/qa/set-up-column'
      case 4:
        return '/qa/qa-config'
      case 5:
        return '/qa/verify'
      case 6:
        return '/qa/results'
      case 1:
      default:
        return '/qa/upload'
    }
  }
  if (view === 'labeling') {
    switch (labelStep) {
      case 2:
        return '/label/project'
      case 3:
        return '/label/set-up-column'
      case 4:
        return '/label/label-config'
      case 5:
        return '/label/results'
      case 1:
      default:
        return '/label/upload'
    }
  }
  if (view === 'compare') {
    if (compareSection === 'results') return '/compare/results'
    if (compareSection === 'config') return '/compare/config'
    return '/compare'
  }
  if (view === 'projects') {
    if (projectsFilter === 'qa') return '/projects/qa'
    if (projectsFilter === 'labeling') return '/projects/label'
    if (projectsFilter === 'compare') return '/projects/compare'
    return '/projects'
  }
  if (view === 'ai-card') return '/ai-card'
  if (view === 'manage') return '/manage'
  return '/'
}

function App() {
  // State quản lý các bước trong quy trình
  const [currentStep, setCurrentStep] = useState(1)
  const [labelStep, setLabelStep] = useState(1)
  
  // State lưu trữ data đã upload
  const [uploadedData, setUploadedData] = useState({
    dataFile: null,
    guidelineFile: null,
    mediaFiles: null
  })
  
  // State lưu trữ column mapping
  const [columnMapping, setColumnMapping] = useState({})
  
  // State lưu trữ project metadata
  const [projectData, setProjectData] = useState({
    name: '',
    description: '',
    created_by: '',
    project_id: null,
    saved: false
  })
  
  // State lưu trữ cấu hình QA
  const [qaConfig, setQaConfig] = useState({
    model: '',
    apiKey: '',
    prompt: ''
  })
  
  // State lưu trữ QA result
  const [qaResult, setQaResult] = useState(null)
  
  // State lưu trữ verification result
  const [verificationResult, setVerificationResult] = useState(null)
  
  // State lưu trữ project & uploadedData cho luồng Xử lý data (khi mở từ danh sách projects)
  const [labelingInitialProject, setLabelingInitialProject] = useState(null)
  const [labelingInitialUploadedData, setLabelingInitialUploadedData] = useState(null)
  const [compareInitialProject, setCompareInitialProject] = useState(null)

  const [qaProjectId, setQaProjectId] = useState(null)
  const [labelProjectId, setLabelProjectId] = useState(null)
  const [compareProjectId, setCompareProjectId] = useState(null)
  const [compareSection, setCompareSection] = useState('upload') // 'upload' | 'config' | 'results'
  const [projectsFilter, setProjectsFilter] = useState('all') // 'all' | 'qa' | 'labeling' | 'compare'

  const [currentUser, setCurrentUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  
  // State hiển thị view
  const [currentView, setCurrentView] = useState('workflow') // 'workflow' | 'labeling' | 'projects' | 'compare' | 'manage'

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

  useEffect(() => {
    try {
      if (currentUser) {
        window.localStorage.setItem('spd_current_user', JSON.stringify(currentUser))
      } else {
        window.localStorage.removeItem('spd_current_user')
      }
    } catch (e) {
      // ignore
    }
  }, [currentUser])

  // Khởi tạo state từ URL lần đầu, nếu không hợp lệ thì fallback từ localStorage
  useEffect(() => {
    try {
      const { view, step, projectId, section, projectsFilter: urlProjectsFilter } = getStateFromPath(window.location.pathname)
      if (view) {
        setCurrentView(view)
        if (view === 'workflow' && step) {
          setCurrentStep(step)
        }
        if (view === 'workflow' && projectId) {
          setQaProjectId(projectId)
        }
        if (view === 'labeling' && step) {
          setLabelStep(step)
        }
        if (view === 'labeling' && projectId) {
          setLabelProjectId(projectId)
        }
        if (view === 'compare') {
          if (section) setCompareSection(section)
          if (projectId) setCompareProjectId(projectId)
        }
        if (view === 'projects' && urlProjectsFilter) {
          setProjectsFilter(urlProjectsFilter)
        }
        return
      }
    } catch (e) {
      // ignore
    }

    try {
      const saved = window.localStorage.getItem('spd_current_view')
      if (saved && ['workflow', 'labeling', 'projects', 'compare', 'manage', 'ai-card'].includes(saved)) {
        setCurrentView(saved)
      }
    } catch (e) {
      // Bỏ qua nếu localStorage không khả dụng
    }
  }, [])

  // Lưu lại view hiện tại mỗi khi thay đổi để F5 vẫn giữ đúng tab
  useEffect(() => {
    try {
      window.localStorage.setItem('spd_current_view', currentView)
    } catch (e) {
      // Bỏ qua nếu localStorage không khả dụng
    }
  }, [currentView])

  // Reset toàn bộ quy trình về trạng thái setup mới
  const resetWorkflow = () => {
    setCurrentStep(1)
    setLabelStep(1)
    setQaProjectId(null)
    setLabelProjectId(null)
    setUploadedData({ dataFile: null, guidelineFile: null, mediaFiles: null })
    setProjectData({ name: '', description: '', created_by: '', project_id: null, saved: false })
    setColumnMapping({})
    setQaConfig({ model: '', apiKey: '', prompt: '' })
    setQaResult(null)
    setVerificationResult(null)
  }

  // Sync URL theo state hiện tại (view + step QA/Label + project IDs + filter Projects)
  useEffect(() => {
    try {
      let path = getPathFromState(currentView, currentStep, labelStep, compareSection, projectsFilter)

      if (currentView === 'workflow' && qaProjectId) {
        path = `${path}/${qaProjectId}`
      } else if (currentView === 'labeling' && labelProjectId) {
        path = `${path}/${labelProjectId}`
      } else if (currentView === 'compare') {
        if (compareProjectId) {
          path = `/compare/results/${compareProjectId}`
        } else {
          path = '/compare'
        }
      }
      if (window.location.pathname !== path) {
        window.history.replaceState({}, '', path)
      }
    } catch (e) {
      // ignore
    }
  }, [currentView, currentStep, labelStep, qaProjectId, labelProjectId, compareProjectId, compareSection, projectsFilter])

  const handleLogout = () => {
    setCurrentUser(null)
    resetWorkflow()
    setCurrentView('workflow')
  }

  const handleLoginSubmit = async (e) => {
    e.preventDefault()
    setAuthError('')
    const username = loginForm.username.trim()
    const password = loginForm.password
    if (!username || !password) {
      setAuthError('Vui lòng nhập username và mật khẩu')
      return
    }
    setAuthLoading(true)
    try {
      const resp = await axios.post('/api/login', { username, password })
      const user = resp.data?.user
      if (!user) {
        setAuthError('Đăng nhập thất bại')
      } else {
        setCurrentUser(user)
        setLoginForm({ username: '', password: '' })
        const defaultView = getDefaultViewForUser(user)
        setCurrentView(defaultView)
      }
    } catch (err) {
      console.error('Login error', err)
      const msg = err?.response?.data?.error || 'Đăng nhập thất bại'
      setAuthError(msg)
    } finally {
      setAuthLoading(false)
    }
  }
  
  // Nếu view hiện tại không phù hợp với quyền thì auto điều chỉnh sang view hợp lệ
  useEffect(() => {
    if (!currentUser) return
    if (!hasPermissionForView(currentUser, currentView)) {
      const fallback = getDefaultViewForUser(currentUser)
      if (fallback !== currentView) {
        setCurrentView(fallback)
      }
    }
  }, [currentUser, currentView])

  // Các bước trong quy trình
  const steps = [
    { id: 1, name: 'Upload Data', icon: Upload },
    { id: 2, name: 'Tạo Project', icon: FileText },
    { id: 3, name: 'Cấu hình Cột', icon: FileText },
    { id: 4, name: 'Cấu hình QA', icon: FileText },
    { id: 5, name: 'Đối chiếu', icon: CheckCircle },
    { id: 6, name: 'Kết quả', icon: AlertCircle }
  ]

  const userRole = (currentUser?.role || '').toLowerCase()
  const isOwner = userRole === 'owner'
  const userPermissions = currentUser?.permissions || []
  const hasPermission = (code) => {
    if (!currentUser) return false
    if (isOwner) return true
    return userPermissions.includes(code)
  }

  const canManageUsers = currentUser && hasPermission('manage_users')

  const mainClassName =
    currentView === 'ai-card'
      ? 'w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-6'
      : 'max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-10 py-8'

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-6 space-y-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 text-center">DL Support System</h1>
            <p className="mt-1 text-sm text-gray-600 text-center">Đăng nhập để sử dụng hệ thống</p>
          </div>
          {authError && (
            <p className="text-xs text-red-600 text-center">{authError}</p>
          )}
          <form className="space-y-4" onSubmit={handleLoginSubmit}>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Username</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={loginForm.username}
                onChange={(e) => setLoginForm((prev) => ({ ...prev, username: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={loginForm.password}
                onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
              />
            </div>
            <button
              type="submit"
              disabled={authLoading}
              className="w-full inline-flex items-center justify-center px-3 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-60"
            >
              {authLoading ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100">
      {/* Header */}
      <header className="bg-white shadow-md">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-10 py-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                DL Support System
              </h1>
              <p className="mt-1 text-sm text-gray-600">
                DL Support System
              </p>
            </div>
            
            {/* Navigation */}
            <div className="flex items-center space-x-6">
              <div className="flex space-x-4">
                {/* QA data */}
                <button
                  onClick={() => {
                    if (!hasPermissionForView(currentUser, 'workflow')) return
                    resetWorkflow()
                    setCurrentView('workflow')
                  }}
                  disabled={!hasPermissionForView(currentUser, 'workflow')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    currentView === 'workflow'
                      ? 'bg-primary-600 text-white'
                      : hasPermissionForView(currentUser, 'workflow')
                      ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  QA data
                </button>

                {/* Label data */}
                <button
                  onClick={() => {
                    if (!hasPermissionForView(currentUser, 'labeling')) return
                    setCurrentView('labeling')
                  }}
                  disabled={!hasPermissionForView(currentUser, 'labeling')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    currentView === 'labeling'
                      ? 'bg-primary-600 text-white'
                      : hasPermissionForView(currentUser, 'labeling')
                      ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Label data
                </button>

                {/* Compare data */}
                <button
                  onClick={() => {
                    if (!hasPermissionForView(currentUser, 'compare')) return
                    setCurrentView('compare')
                  }}
                  disabled={!hasPermissionForView(currentUser, 'compare')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    currentView === 'compare'
                      ? 'bg-primary-600 text-white'
                      : hasPermissionForView(currentUser, 'compare')
                      ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Compare data
                </button>

                {/* Projects */}
                <button
                  onClick={() => {
                    if (!hasPermissionForView(currentUser, 'projects')) return
                    setCurrentView('projects')
                  }}
                  disabled={!hasPermissionForView(currentUser, 'projects')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    currentView === 'projects'
                      ? 'bg-primary-600 text-white'
                      : hasPermissionForView(currentUser, 'projects')
                      ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Projects
                </button>

                {/* AI Card */}
                <button
                  onClick={() => {
                    if (!hasPermissionForView(currentUser, 'ai-card')) return
                    setCurrentView('ai-card')
                  }}
                  disabled={!hasPermissionForView(currentUser, 'ai-card')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    currentView === 'ai-card'
                      ? 'bg-primary-600 text-white'
                      : hasPermissionForView(currentUser, 'ai-card')
                      ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  AI Card
                </button>
                {canManageUsers && (
                  <button
                    onClick={() => setCurrentView('manage')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center space-x-2 ${
                      currentView === 'manage'
                        ? 'bg-primary-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    <Settings className="w-4 h-4" />
                    <span>Manage</span>
                  </button>
                )}
              </div>
              <div className="flex items-center space-x-2 text-sm text-gray-700">
                <span className="px-2 py-1 rounded bg-gray-100 font-mono">
                  {currentUser.username} ({currentUser.role})
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="px-3 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-100"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className={mainClassName}>
        {currentView === 'workflow' ? (
          <>
            {/* Progress Steps */}
            <div className="mb-8">
              <div className="flex items-center justify-between">
                {steps.map((step, index) => {
                  const Icon = step.icon
                  const isActive = currentStep === step.id
                  const isCompleted = currentStep > step.id
                  
                  return (
                    <React.Fragment key={step.id}>
                      <div className="flex flex-col items-center">
                        <div
                          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                            isActive
                              ? 'bg-primary-600 text-white scale-110'
                              : isCompleted
                              ? 'bg-green-500 text-white'
                              : 'bg-gray-300 text-gray-600'
                          }`}
                        >
                          <Icon size={24} />
                        </div>
                        <span
                          className={`mt-2 text-sm font-medium ${
                            isActive
                              ? 'text-primary-600'
                              : isCompleted
                              ? 'text-green-600'
                              : 'text-gray-500'
                          }`}
                        >
                          {step.name}
                        </span>
                      </div>
                      
                      {index < steps.length - 1 && (
                        <div
                          className={`flex-1 h-1 mx-4 transition-all ${
                            isCompleted ? 'bg-green-500' : 'bg-gray-300'
                          }`}
                        />
                      )}
                    </React.Fragment>
                  )
                })}
              </div>
            </div>

            {/* Content dựa theo step hiện tại */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              {currentStep === 1 && (
                <UploadSection
                  uploadedData={uploadedData}
                  setUploadedData={setUploadedData}
                  onNext={() => setCurrentStep(2)}
                />
              )}
              
              {currentStep === 2 && (
                <ProjectCreation
                  uploadedData={uploadedData}
                  projectData={projectData}
                  setProjectData={setProjectData}
                  onNext={() => setCurrentStep(3)}
                  onBack={() => setCurrentStep(1)}
                />
              )}
              
              {currentStep === 3 && (
                <ColumnMapping
                  uploadedData={uploadedData}
                  columnMapping={columnMapping}
                  setColumnMapping={setColumnMapping}
                  onNext={() => setCurrentStep(4)}
                  onBack={() => setCurrentStep(2)}
                />
              )}
              
              {currentStep === 4 && (
                <QAConfiguration
                  uploadedData={uploadedData}
                  columnMapping={columnMapping}
                  qaConfig={qaConfig}
                  setQaConfig={setQaConfig}
                  setQaResult={setQaResult}
                  projectData={projectData}
                  onNext={() => setCurrentStep(5)}
                  onBack={() => setCurrentStep(3)}
                />
              )}
              
              {currentStep === 5 && (
                <VerificationSection
                  qaResult={qaResult}
                  setVerificationResult={setVerificationResult}
                  onNext={() => setCurrentStep(6)}
                  onBack={() => setCurrentStep(4)}
                />
              )}
              
              {currentStep === 6 && (
                <ResultsView
                  qaResult={qaResult}
                  verificationResult={verificationResult}
                  onBack={() => setCurrentStep(3)}
                  onReset={resetWorkflow}
                />
              )}
            </div>
          </>
        ) : currentView === 'labeling' ? (
          <LabelWorkflow
            initialUploadedData={labelingInitialUploadedData}
            initialProject={labelingInitialProject}
            step={labelStep}
            onStepChange={setLabelStep}
          />
        ) : currentView === 'compare' ? (
          <CompareData initialProject={compareInitialProject} />
        ) : currentView === 'projects' ? (
          <ProjectsList 
            filterType={projectsFilter}
            onFilterChange={setProjectsFilter}
            onOpenProject={(data) => {
              const projectType = data.project.project_type || 'qa'

              // Nếu là project cho Xử lý data (labeling) thì chuyển sang view labeling
              if (projectType === 'labeling') {
                setLabelingInitialUploadedData(data.uploadedData)
                setLabelingInitialProject(data.project)
                setCurrentView('labeling')
                return
              }

              // Nếu là project Compare data thì chuyển sang view compare
              if (projectType === 'compare') {
                setCompareInitialProject(data.project)
                setCurrentView('compare')
                return
              }

              // Ngược lại, xử lý như luồng Quy trình QA hiện tại
              // Load project data back to states
              setUploadedData(data.uploadedData)
              setProjectData({
                name: data.project.name,
                description: data.project.description,
                created_by: data.project.created_by,
                project_id: data.project.project_id,
                saved: true
              })

              // Khôi phục columnMapping nếu project có lưu
              if (data.project.column_mapping) {
                setColumnMapping(data.project.column_mapping)
              } else {
                setColumnMapping({})
              }

              // Khôi phục qaConfig (không có apiKey, user nhập lại)
              if (data.project.qa_config) {
                setQaConfig(prev => ({
                  ...prev,
                  provider: data.project.qa_config.provider || prev.provider,
                  specificModel: data.project.qa_config.specificModel || prev.specificModel,
                  model: data.project.qa_config.model || prev.model,
                  prompt: data.project.qa_config.prompt || prev.prompt,
                  apiKey: ''
                }))
              } else {
                setQaConfig({ model: '', apiKey: '', prompt: '' })
              }

              // Reset kết quả QA/verification (có thể sau này cho mở lại kết quả)
              setQaResult(null)
              setVerificationResult(null)
              
              // Switch to workflow
              setCurrentView('workflow')

              const projectStatus = data.project.status || 'created'

              // Nếu project đã có QA (last_qa_id) thì quyết định mở bước nào theo status thực tế
              if (data.project.last_qa_id) {
                const initialQaStatus = projectStatus
                setQaResult({
                  qa_id: data.project.last_qa_id,
                  status: initialQaStatus
                })
                setVerificationResult(null)

                if (initialQaStatus === 'completed') {
                  // Đã hoàn thành: mở màn kết quả như cũ
                  setCurrentStep(6)
                } else {
                  // Đang processing/paused: mở màn theo dõi QA để có thể resume từ checkpoint
                  setCurrentStep(5)
                }
              } else {
                // Chưa có QA: tiếp tục từ bước mapping hoặc cấu hình QA như cũ
                setQaResult(null)
                setVerificationResult(null)
                if (data.project.column_mapping && Object.keys(data.project.column_mapping).length > 0) {
                  setCurrentStep(4)
                } else {
                  setCurrentStep(3)
                }
              }
            }}
          />
        ) : currentView === 'ai-card' ? (
          <AiCardPage currentUser={currentUser} />
        ) : currentView === 'manage' && canManageUsers ? (
          <ManageUsers />
        ) : currentView === 'manage' ? (
          <div className="bg-white border border-red-200 rounded-lg p-6 text-sm text-red-700">
            Bạn không có quyền truy cập trang Manage.
          </div>
        ) : null}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-10 py-6">
          <p className="text-center text-gray-600 text-sm">
          </p>
        </div>
      </footer>
    </div>
  )
}

export default App
