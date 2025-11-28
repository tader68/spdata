/**
 * Flow Xử lý data (Labeling)
 * Tách biệt với Quy trình QA, nhưng reuse UploadSection, ProjectCreation, ColumnMapping.
 */

import React, { useState, useEffect } from 'react'
import { Upload, FileText, Tag, CheckCircle } from 'lucide-react'
import UploadSection from './UploadSection'
import ProjectCreation from './ProjectCreation'
import ColumnMapping from './ColumnMapping'
import LabelConfiguration from './LabelConfiguration'
import LabelResultsView from './LabelResultsView'

const LabelWorkflow = ({ initialUploadedData, initialProject, step, onStepChange }) => {
  // Cho phép controlled từ bên ngoài (App) để đồng bộ với URL
  const [internalStep, setInternalStep] = useState(step || 1)
  const currentStep = typeof step === 'number' ? step : internalStep
  const setCurrentStep = onStepChange || setInternalStep

  const [uploadedData, setUploadedData] = useState({
    dataFile: null,
    guidelineFile: null,
    mediaFiles: null
  })

  const [projectData, setProjectData] = useState({
    name: '',
    description: '',
    created_by: '',
    project_id: null,
    saved: false
  })

  const [columnMapping, setColumnMapping] = useState({})

  const [labelConfig, setLabelConfig] = useState({
    model: '',
    apiKey: '',
    prompt: ''
  })

  const [labelResult, setLabelResult] = useState(null)
  const [outputConfig, setOutputConfig] = useState([
    { key: 'tag', description: 'Tag chính của data (ví dụ: identity, document, other...)' },
    { key: 'cate1', description: 'Nhóm/loại chính (ví dụ: căn cước công dân, CMND, hộ chiếu...)' }
  ])

  // Khi mở project từ danh sách (labeling), đổ dữ liệu ban đầu vào state
  useEffect(() => {
    if (initialUploadedData) {
      setUploadedData(initialUploadedData)
    }

    if (initialProject) {
      // Khôi phục thông tin project cơ bản
      setProjectData(prev => ({
        ...prev,
        name: initialProject.name || prev.name,
        description: initialProject.description || prev.description,
        created_by: initialProject.created_by || prev.created_by,
        project_id: initialProject.project_id || prev.project_id,
        saved: true
      }))

      // Khôi phục column mapping nếu project đã lưu
      if (initialProject.column_mapping && Object.keys(initialProject.column_mapping || {}).length > 0) {
        setColumnMapping(initialProject.column_mapping)
      }

      // Khôi phục cấu hình labeling (trừ API key)
      if (initialProject.label_config) {
        setLabelConfig(prev => ({
          ...prev,
          provider: initialProject.label_config.provider || prev.provider,
          specificModel: initialProject.label_config.specificModel || prev.specificModel,
          model: initialProject.label_config.model || prev.model,
          prompt: initialProject.label_config.prompt || prev.prompt,
          apiKey: ''
        }))
      }

      // Quyết định bước bắt đầu khi mở lại project
      if (initialProject.last_label_id) {
        // Project đã có session labeling -> mở màn Kết quả Label
        const status = initialProject.status || 'completed'
        setLabelResult({
          label_id: initialProject.last_label_id,
          status
        })
        setCurrentStep(5)
      } else if (initialProject.column_mapping && Object.keys(initialProject.column_mapping || {}).length > 0) {
        // Đã cấu hình cột nhưng chưa chạy labeling -> nhảy tới bước cấu hình Label
        setCurrentStep(4)
      } else {
        // Mặc định bắt đầu từ bước Tạo Project (data/guideline đã có sẵn)
        setCurrentStep(2)
      }
    }
  }, [initialUploadedData, initialProject])

  const resetWorkflow = () => {
    setCurrentStep(1)
    setUploadedData({ dataFile: null, guidelineFile: null, mediaFiles: null })
    setProjectData({ name: '', description: '', created_by: '', project_id: null, saved: false })
    setColumnMapping({})
    setLabelConfig({ model: '', apiKey: '', prompt: '' })
    setLabelResult(null)
  }

  const steps = [
    { id: 1, name: 'Upload Data', icon: Upload },
    { id: 2, name: 'Tạo Project', icon: FileText },
    { id: 3, name: 'Cấu hình Cột', icon: Tag },
    { id: 4, name: 'Cấu hình Label', icon: FileText },
    { id: 5, name: 'Kết quả Label', icon: CheckCircle }
  ]

  return (
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

      {/* Content theo step */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        {currentStep === 1 && (
          <UploadSection
            uploadedData={uploadedData}
            setUploadedData={setUploadedData}
            mode="labeling"
            onNext={() => setCurrentStep(2)}
          />
        )}

        {currentStep === 2 && (
          <ProjectCreation
            uploadedData={uploadedData}
            projectData={projectData}
            setProjectData={setProjectData}
            projectType="labeling"
            onNext={() => setCurrentStep(3)}
            onBack={() => setCurrentStep(1)}
          />
        )}

        {currentStep === 3 && (
          <ColumnMapping
            uploadedData={uploadedData}
            columnMapping={columnMapping}
            setColumnMapping={setColumnMapping}
            mode="labeling"
            outputConfig={outputConfig}
            setOutputConfig={setOutputConfig}
            onNext={() => setCurrentStep(4)}
            onBack={() => setCurrentStep(2)}
          />
        )}

        {currentStep === 4 && (
          <LabelConfiguration
            uploadedData={uploadedData}
            columnMapping={columnMapping}
            labelConfig={labelConfig}
            setLabelConfig={setLabelConfig}
            setLabelResult={setLabelResult}
            projectData={projectData}
            outputConfig={outputConfig}
            onNext={() => setCurrentStep(5)}
            onBack={() => setCurrentStep(3)}
          />
        )}

        {currentStep === 5 && (
          <LabelResultsView
            labelResult={labelResult}
            onBack={() => setCurrentStep(4)}
            onReset={resetWorkflow}
          />
        )}
      </div>
    </>
  )
}

export default LabelWorkflow
