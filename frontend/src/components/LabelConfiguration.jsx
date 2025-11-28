/**
 * Cấu hình LABELING (Xử lý data)
 * Giống QAConfiguration nhưng gọi /api/label/* và không có verifier.
 */

import React, { useState } from 'react'
import { Bot, Key, FileText, Loader, Sparkles } from 'lucide-react'
import axios from 'axios'

const LabelConfiguration = ({
  uploadedData,
  columnMapping,
  labelConfig,
  setLabelConfig,
  setLabelResult,
  projectData,
  outputConfig = [],
  onNext,
  onBack,
}) => {
  const [generating, setGenerating] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState(null)

  // Danh sách models cho từng provider (giống QA)
  const modelOptions = {
    chatgpt: [
      { value: 'gpt-4o', label: 'GPT-4o (Recommended)', description: 'Model mới nhất, mạnh nhất' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini', description: 'Nhanh và tiết kiệm' },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo', description: 'Phiên bản cũ ổn định' },
      { value: 'custom', label: 'Tự nhập model khác', description: 'Nhập tên model tùy chỉnh' }
    ],
    gemini: [
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Recommended)', description: 'Tốt nhất về giá/hiệu suất' },
      { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', description: 'Phiên bản nhẹ hơn, tốc độ cao' },
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Model cao cấp nhất' },
      { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview', description: 'Phiên bản preview thế hệ 3' },
      { value: 'gemini-3-pro', label: 'Gemini 3 Pro', description: 'Model thế hệ 3 cao cấp' },
      { value: 'gemini-2.5-flash-preview-09-2025', label: 'Gemini 2.5 Flash Preview', description: 'Phiên bản preview' },
      { value: 'custom', label: 'Tự nhập model khác', description: 'Nhập tên model tùy chỉnh' }
    ]
  }

  const generatePrompt = async () => {
    if (!labelConfig.apiKey) {
      setError('Vui lòng nhập API key trước')
      return
    }

    if (!uploadedData.guidelineFile?.info?.file_id) {
      setError('Vui lòng upload guideline trước khi sinh prompt labeling')
      return
    }

    setGenerating(true)
    setError(null)

    try {
      // Bước sinh prompt labeling luôn dùng Gemini; cho phép chọn model riêng cho bước này
      const provider = 'gemini'
      let specificModel = labelConfig.promptSpecificModel || 'gemini-2.5-flash'

      if (specificModel === 'custom') {
        specificModel = labelConfig.promptSpecificModelCustom || 'gemini-2.5-flash'
      }

      const response = await axios.post('/api/label/generate-prompt', {
        guideline_id: uploadedData.guidelineFile?.info?.file_id,
        api_key: labelConfig.apiKey,
        provider,
        specificModel
      })

      setLabelConfig({
        ...labelConfig,
        prompt: response.data.prompt
      })
    } catch (err) {
      setError(err.response?.data?.error || 'Lỗi khi sinh prompt labeling')
    } finally {
      setGenerating(false)
    }
  }

  const startLabeling = async () => {
    if (!labelConfig.apiKey || !labelConfig.prompt) {
      setError('Vui lòng nhập API key và prompt labeling')
      return
    }

    if (!uploadedData.dataFile?.info?.file_id) {
      setError('Thiếu file data để labeling')
      return
    }

    if (!uploadedData.guidelineFile?.info?.file_id) {
      setError('Thiếu guideline để labeling')
      return
    }

    setStarting(true)
    setError(null)

    try {
      let provider = labelConfig.provider || 'gemini'
      let specificModel = labelConfig.specificModel
      const modelName = labelConfig.customModel || labelConfig.model

      if (!specificModel || specificModel === 'custom') {
        specificModel = modelName
      }

      if (!specificModel) {
        if (provider === 'gemini') {
          specificModel = 'gemini-2.5-flash'
        } else if (provider === 'chatgpt') {
          specificModel = 'gpt-4o'
        } else {
          specificModel = provider
        }
      }

      const requestData = {
        data_id: uploadedData.dataFile?.info?.file_id,
        guideline_id: uploadedData.guidelineFile?.info?.file_id,
        provider,
        specificModel,
        model: specificModel,
        api_key: labelConfig.apiKey,
        prompt: labelConfig.prompt,
        columnMapping: columnMapping,
        output_config: (outputConfig || []).filter((f) => f && f.key && f.key.trim().length > 0),
      }

      if (projectData?.project_id) {
        requestData.project_id = projectData.project_id
      }

      // Truyền thông tin media cho backend
      // Case 1: Vừa upload media trong session hiện tại (info.files có path/filename) -> gửi full media_files
      const infoFiles = uploadedData.mediaFiles?.info?.files || []
      const hasMediaMeta =
        Array.isArray(infoFiles) &&
        infoFiles.length > 0 &&
        (infoFiles[0].path || infoFiles[0].filename)

      if (hasMediaMeta) {
        requestData.media_files = infoFiles
      } else if (uploadedData.mediaFiles?.info?.batch_id) {
        // Case 2: Reuse media từ project đã lưu -> chỉ có batch_id, backend sẽ tự load từ metadata
        requestData.media_batch_id = uploadedData.mediaFiles.info.batch_id
      }

      const response = await axios.post('/api/label/start', requestData)

      setLabelResult({
        label_id: response.data.label_id,
        status: 'processing'
      })

      onNext()
    } catch (err) {
      setError(err.response?.data?.error || 'Lỗi khi bắt đầu labeling')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Bước 3: Cấu Hình Labeling
        </h2>
        <p className="text-gray-600">
          Chọn model AI và cấu hình prompt để gán label cho data theo guideline
        </p>
      </div>

      {/* Chọn Model */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Bot className="w-6 h-6 text-primary-600" />
          <h3 className="text-lg font-semibold text-gray-900">
            Chọn Model AI
          </h3>
        </div>

        {/* Bước 1: Chọn Provider */}
        <div className="space-y-4">
          <h4 className="text-md font-medium text-gray-700">1. Chọn AI Provider:</h4>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setLabelConfig({ ...labelConfig, provider: 'chatgpt', specificModel: '', customModel: '' })}
              className={`p-4 border-2 rounded-lg transition-all ${
                labelConfig.provider === 'chatgpt'
                  ? 'border-primary-600 bg-primary-50'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <div className="text-center">
                <div className="text-2xl mb-2">🤖</div>
                <p className="font-semibold text-gray-900">ChatGPT</p>
                <p className="text-sm text-gray-600 mt-1">OpenAI Models</p>
              </div>
            </button>

            <button
              onClick={() => setLabelConfig({ ...labelConfig, provider: 'gemini', specificModel: '', customModel: '' })}
              className={`p-4 border-2 rounded-lg transition-all ${
                labelConfig.provider === 'gemini'
                  ? 'border-primary-600 bg-primary-50'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <div className="text-center">
                <div className="text-2xl mb-2">✨</div>
                <p className="font-semibold text-gray-900">Gemini</p>
                <p className="text-sm text-gray-600 mt-1">Google AI Models</p>
              </div>
            </button>
          </div>
        </div>

        {/* Bước 2: Chọn Model cụ thể */}
        {labelConfig.provider && (
          <div className="space-y-4 pt-4 border-t border-gray-200">
            <h4 className="text-md font-medium text-gray-700">
              2. Chọn Model {labelConfig.provider === 'chatgpt' ? 'ChatGPT' : 'Gemini'}:
            </h4>

            <div className="space-y-3">
              {modelOptions[labelConfig.provider]?.map((model) => (
                <label key={model.value} className="flex items-start space-x-3 cursor-pointer">
                  <input
                    type="radio"
                    name="labelSpecificModel"
                    value={model.value}
                    checked={labelConfig.specificModel === model.value}
                    onChange={(e) =>
                      setLabelConfig({
                        ...labelConfig,
                        specificModel: e.target.value,
                        model: model.value === 'custom' ? labelConfig.provider : model.value
                      })
                    }
                    className="mt-1 w-4 h-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{model.label}</p>
                    <p className="text-sm text-gray-600">{model.description}</p>
                  </div>
                </label>
              ))}
            </div>

            {labelConfig.specificModel === 'custom' && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nhập tên model tùy chỉnh:
                </label>
                <input
                  type="text"
                  value={labelConfig.customModel || ''}
                  onChange={(e) =>
                    setLabelConfig({
                      ...labelConfig,
                      customModel: e.target.value,
                      model: e.target.value
                    })
                  }
                  placeholder={labelConfig.provider === 'chatgpt' ? 'Ví dụ: gpt-4-1106-preview' : 'Ví dụ: gemini-1.5-pro'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* API Key */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Key className="w-6 h-6 text-primary-600" />
          <h3 className="text-lg font-semibold text-gray-900">API Key</h3>
        </div>

        <input
          type="password"
          value={labelConfig.apiKey || ''}
          onChange={(e) => setLabelConfig({ ...labelConfig, apiKey: e.target.value })}
          placeholder={`Nhập API key của ${labelConfig.model || 'model'}`}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />

        <p className="mt-2 text-sm text-gray-600">
          API key sẽ được sử dụng để gọi {labelConfig.provider === 'chatgpt' ? 'OpenAI' : 'Google Gemini'} API
        </p>
      </div>

      {/* Prompt */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <FileText className="w-6 h-6 text-primary-600" />
            <h3 className="text-lg font-semibold text-gray-900">Prompt Labeling</h3>
          </div>

          <button
            onClick={generatePrompt}
            disabled={generating || !labelConfig.apiKey}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-all ${
              generating || !labelConfig.apiKey
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-700 hover:to-pink-700 shadow-lg'
            }`}
          >
            {generating ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                <span>Đang sinh...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Sinh tự động</span>
              </>
            )}
          </button>
        </div>

        {/* Model dùng để sinh prompt (Gemini) */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Model dùng để sinh prompt (Gemini):
          </label>
          <select
            value={labelConfig.promptSpecificModel || 'gemini-2.5-flash'}
            onChange={(e) => {
              const value = e.target.value
              setLabelConfig({
                ...labelConfig,
                promptSpecificModel: value
              })
            }}
            className="w-full md:w-1/2 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
          >
            {modelOptions.gemini.map((model) => (
              <option key={model.value} value={model.value}>
                {model.label}
              </option>
            ))}
          </select>

          {labelConfig.promptSpecificModel === 'custom' && (
            <div className="mt-2">
              <input
                type="text"
                value={labelConfig.promptSpecificModelCustom || ''}
                onChange={(e) =>
                  setLabelConfig({
                    ...labelConfig,
                    promptSpecificModelCustom: e.target.value
                  })
                }
                placeholder="Nhập tên model Gemini để sinh prompt, ví dụ: gemini-2.5-pro"
                className="w-full md:w-1/2 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Nếu để trống, hệ thống sẽ dùng mặc định gemini-2.5-flash.
              </p>
            </div>
          )}

          <p className="mt-1 text-xs text-gray-500">
            Bước sinh prompt chỉ dùng để phân tích guideline, nên ưu tiên chọn model mạnh nhất (ví dụ Gemini 2.5 Pro).
          </p>
        </div>

        <textarea
          value={labelConfig.prompt || ''}
          onChange={(e) => setLabelConfig({ ...labelConfig, prompt: e.target.value })}
          placeholder="Nhập prompt hoặc click 'Sinh tự động' để AI tạo prompt labeling từ guideline..."
          rows={12}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono text-sm"
        />

        <p className="mt-2 text-sm text-gray-600">
          Prompt này sẽ được sử dụng để hướng dẫn AI gán label cho từng dòng data theo guideline.
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
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
          onClick={startLabeling}
          disabled={starting || !labelConfig.apiKey || !labelConfig.prompt}
          className={`px-6 py-3 rounded-lg font-semibold transition-all ${
            starting || !labelConfig.apiKey || !labelConfig.prompt
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-primary-600 text-white hover:bg-primary-700 shadow-lg hover:shadow-xl'
          }`}
        >
          {starting ? (
            <span className="flex items-center space-x-2">
              <Loader className="w-5 h-5 animate-spin" />
              <span>Đang bắt đầu...</span>
            </span>
          ) : (
            'Bắt đầu Label →'
          )}
        </button>
      </div>
    </div>
  )
}

export default LabelConfiguration
