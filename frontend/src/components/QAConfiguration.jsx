/**
 * Component cấu hình QA
 * Chọn model AI, nhập API key, sinh và chỉnh sửa prompt
 */

import React, { useState, useEffect } from 'react'
import { Bot, Key, FileText, Loader, Sparkles } from 'lucide-react'
import axios from 'axios'

const QAConfiguration = ({ uploadedData, columnMapping, qaConfig, setQaConfig, setQaResult, projectData, onNext, onBack }) => {
  const [generating, setGenerating] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState(null)
  const [numCheckers, setNumCheckers] = useState(1)
  const [verifiers, setVerifiers] = useState([])
  const [qaTemplates, setQaTemplates] = useState([])

  useEffect(() => {
    const fetchQaTemplates = async () => {
      try {
        const response = await axios.get('/api/projects')
        const projects = response.data?.projects || []
        const withQaConfig = projects.filter(
          (p) => p.qa_config && Object.keys(p.qa_config || {}).length > 0
        )
        setQaTemplates(withQaConfig)
      } catch (err) {
        console.error('[ERROR] Failed to load QA config templates from projects:', err)
      }
    }

    fetchQaTemplates()
  }, [])

  const updateVerifier = (index, field, value) => {
    const next = [...verifiers]
    if (!next[index]) {
      next[index] = { model: '', apiKey: '', prompt: '' }
    }
    next[index][field] = value
    setVerifiers(next)
  }

  const fillDefaultVerifierPrompt = (index) => {
    const next = [...verifiers]
    const current = next[index] || { model: '', apiKey: '', prompt: '' }
    const basePrompt = qaConfig.prompt || 'Bạn là một AI kiểm tra chất lượng data labeling theo guideline.'
    next[index] = {
      ...current,
      prompt: `${basePrompt}

Bạn là một AI verifier kiểm tra lại chất lượng data labeling đã được Người QA 1 đánh giá.

Nhiệm vụ của bạn:
1. Đọc kỹ guideline và yêu cầu trong prompt trên.
2. Đánh giá lại dữ liệu gốc theo guideline một cách độc lập.
3. So sánh kết quả của bạn với kết quả QA ban đầu (Người QA 1).
4. Chỉ ra các điểm giống nhau, khác nhau và giải thích lý do.

Trả về kết quả DUY NHẤT dưới dạng JSON với các trường:
{
  "is_correct": true/false,
  "errors": ["lỗi 1", "lỗi 2", ...],
  "suggestions": ["gợi ý 1", "gợi ý 2", ...],
  "confidence_score": 0-100,
  "explanation": "Giải thích chi tiết về đánh giá của bạn",
  "agreement_with_previous": true/false,
  "differences": ["khác biệt 1", "khác biệt 2", ...]
}`
    }
    setVerifiers(next)
  }

  const applyQaTemplate = (projectId) => {
    if (!projectId) return
    const templateProject = qaTemplates.find((p) => p.project_id === projectId)
    if (!templateProject || !templateProject.qa_config) return

    const cfg = templateProject.qa_config
    setQaConfig((prev) => ({
      ...prev,
      provider: cfg.provider || prev.provider || 'gemini',
      specificModel: cfg.specificModel || cfg.model || prev.specificModel,
      model: cfg.model || prev.model,
      prompt: cfg.prompt || prev.prompt,
      // Không reuse API key, để user nhập lại cho an toàn
      apiKey: prev.apiKey || ''
    }))
  }

  // Danh sách models cho từng provider
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

  // Sinh prompt tự động từ guideline
  const generatePrompt = async () => {
    if (!qaConfig.apiKey) {
      setError('Vui lòng nhập API key trước')
      return
    }

    setGenerating(true)
    setError(null)

    try {
      // Bước sinh prompt luôn dùng Gemini; cho phép chọn model riêng cho bước này
      const provider = 'gemini'
      let specificModel = qaConfig.promptSpecificModel || 'gemini-2.5-flash'

      // Nếu chọn 'Tự nhập model khác' thì lấy từ ô input custom
      if (specificModel === 'custom') {
        specificModel = qaConfig.promptSpecificModelCustom || 'gemini-2.5-flash'
      }

      const response = await axios.post('/api/generate-prompt', {
        guideline_id: uploadedData.guidelineFile?.info?.file_id,
        api_key: qaConfig.apiKey,
        provider,
        specificModel
      })

      setQaConfig({
        ...qaConfig,
        prompt: response.data.prompt
      })
    } catch (err) {
      setError(err.response?.data?.error || 'Lỗi khi sinh prompt')
    } finally {
      setGenerating(false)
    }
  }

  // Bắt đầu QA
  const startQA = async () => {
    if (!qaConfig.apiKey || !qaConfig.prompt) {
      setError('Vui lòng nhập API key và prompt cho Người QA 1')
      return
    }

    if (numCheckers > 1) {
      for (let i = 0; i < numCheckers - 1; i++) {
        const v = verifiers[i]
        if (!v || !v.model || !v.apiKey || !v.prompt) {
          setError(`Vui lòng chọn model, nhập API key và prompt cho Người QA ${i + 2}`)
          return
        }
      }
    }

    setStarting(true)
    setError(null)

    try {
      let provider = qaConfig.provider || 'gemini'
      let specificModel = qaConfig.specificModel
      const modelName = qaConfig.customModel || qaConfig.model

      // Nếu chọn custom hoặc chưa có specificModel, dùng tên model thực từ customModel/model
      if (!specificModel || specificModel === 'custom') {
        specificModel = modelName
      }

      // Fallback về model mặc định theo provider nếu vẫn chưa có
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
        provider: provider,
        specificModel: specificModel,
        // Gửi kèm model thực téng để backend có thể dùng cho compat nếu cần
        model: specificModel,
        api_key: qaConfig.apiKey,
        prompt: qaConfig.prompt,
        columnMapping: columnMapping,
        num_checkers: numCheckers
      }

      if (numCheckers > 1) {
        requestData.verifiers = verifiers.slice(0, numCheckers - 1).map((v) => ({
          model: v.model,
          apiKey: v.apiKey,
          prompt: v.prompt
        }))
      }

      if (projectData?.project_id) {
        requestData.project_id = projectData.project_id
      }

      // Truyền thông tin media cho backend (tương tự Labeling)
      const infoFiles = uploadedData.mediaFiles?.info?.files || []
      const hasMediaMeta =
        Array.isArray(infoFiles) &&
        infoFiles.length > 0 &&
        (infoFiles[0].path || infoFiles[0].filename)

      if (hasMediaMeta) {
        // Case upload media mới trong session hiện tại: gửi full danh sách file để backend dùng trực tiếp
        requestData.media_files = infoFiles
      } else if (uploadedData.mediaFiles?.info?.batch_id) {
        // Case reuse project cũ: chỉ có batch_id, backend sẽ tự load metadata
        requestData.media_batch_id = uploadedData.mediaFiles.info.batch_id
      }

      const response = await axios.post('/api/qa/start', requestData)

      setQaResult({
        qa_id: response.data.qa_id,
        status: 'processing'
      })

      onNext()
    } catch (err) {
      setError(err.response?.data?.error || 'Lỗi khi bắt đầu QA')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Bước 2: Cấu Hình QA
        </h2>
        <p className="text-gray-600">
          Chọn model AI và cấu hình prompt để kiểm tra chất lượng data
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-gray-700">
            Số người QA
          </div>
          <select
            value={numCheckers}
            onChange={(e) =>
              setNumCheckers(
                Math.min(5, Math.max(1, Number(e.target.value) || 1))
              )
            }
            className="ml-4 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        {numCheckers > 1 && (
          <p className="mt-2 text-sm text-gray-600">
            Người QA 1 là người chấm chính, các Người QA còn lại sẽ kiểm tra lại
            đánh giá của QA 1.
          </p>
        )}
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
              onClick={() => setQaConfig({ ...qaConfig, provider: 'chatgpt', specificModel: '', customModel: '' })}
              className={`p-4 border-2 rounded-lg transition-all ${
                qaConfig.provider === 'chatgpt'
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
              onClick={() => setQaConfig({ ...qaConfig, provider: 'gemini', specificModel: '', customModel: '' })}
              className={`p-4 border-2 rounded-lg transition-all ${
                qaConfig.provider === 'gemini'
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
        {qaConfig.provider && (
          <div className="space-y-4 pt-4 border-t border-gray-200">
            <h4 className="text-md font-medium text-gray-700">
              2. Chọn Model {qaConfig.provider === 'chatgpt' ? 'ChatGPT' : 'Gemini'}:
            </h4>
            
            <div className="space-y-3">
              {modelOptions[qaConfig.provider]?.map((model) => (
                <label key={model.value} className="flex items-start space-x-3 cursor-pointer">
                  <input
                    type="radio"
                    name="specificModel"
                    value={model.value}
                    checked={qaConfig.specificModel === model.value}
                    onChange={(e) => setQaConfig({ 
                      ...qaConfig, 
                      specificModel: e.target.value,
                      model: model.value === 'custom' ? qaConfig.provider : model.value
                    })}
                    className="mt-1 w-4 h-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{model.label}</p>
                    <p className="text-sm text-gray-600">{model.description}</p>
                  </div>
                </label>
              ))}
            </div>

            {/* Input tùy chỉnh nếu chọn custom */}
            {qaConfig.specificModel === 'custom' && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nhập tên model tùy chỉnh:
                </label>
                <input
                  type="text"
                  value={qaConfig.customModel || ''}
                  onChange={(e) => setQaConfig({ 
                    ...qaConfig, 
                    customModel: e.target.value,
                    model: e.target.value
                  })}
                  placeholder={qaConfig.provider === 'chatgpt' ? 'Ví dụ: gpt-4-1106-preview' : 'Ví dụ: gemini-1.0-pro'}
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
          <h3 className="text-lg font-semibold text-gray-900">
            API Key
          </h3>
        </div>

        <input
          type="password"
          value={qaConfig.apiKey}
          onChange={(e) => setQaConfig({ ...qaConfig, apiKey: e.target.value })}
          placeholder={`Nhập API key của ${qaConfig.model || 'model'}`}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
        
        <p className="mt-2 text-sm text-gray-600">
          API key sẽ được sử dụng để gọi {qaConfig.model === 'chatgpt' ? 'OpenAI' : 'Google Gemini'} API
        </p>
      </div>

      {/* Prompt */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <FileText className="w-6 h-6 text-primary-600" />
            <h3 className="text-lg font-semibold text-gray-900">
              Prompt QA
            </h3>
          </div>

          <button
            onClick={generatePrompt}
            disabled={generating || !qaConfig.apiKey}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-all ${
              generating || !qaConfig.apiKey
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
            value={qaConfig.promptSpecificModel || 'gemini-2.5-flash'}
            onChange={(e) => {
              const value = e.target.value
              setQaConfig({
                ...qaConfig,
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

          {qaConfig.promptSpecificModel === 'custom' && (
            <div className="mt-2">
              <input
                type="text"
                value={qaConfig.promptSpecificModelCustom || ''}
                onChange={(e) =>
                  setQaConfig({
                    ...qaConfig,
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

        {qaTemplates.length > 0 && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Dùng lại cấu hình QA từ project:
            </label>
            <select
              defaultValue=""
              onChange={(e) => applyQaTemplate(e.target.value)}
              className="w-full md:w-1/2 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">-- Chọn project --</option>
              {qaTemplates.map((p) => (
                <option key={p.project_id} value={p.project_id}>
                  {p.name || p.project_id}
                  {p.qa_config?.provider
                    ? ` (${p.qa_config.provider}/${p.qa_config.specificModel || p.qa_config.model || ''})`
                    : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <textarea
          value={qaConfig.prompt}
          onChange={(e) => setQaConfig({ ...qaConfig, prompt: e.target.value })}
          placeholder="Nhập prompt hoặc click 'Sinh tự động' để AI tạo prompt từ guideline..."
          rows={12}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono text-sm"
        />

        <p className="mt-2 text-sm text-gray-600">
          Prompt này sẽ được sử dụng để hướng dẫn AI kiểm tra chất lượng data theo guideline
        </p>
      </div>

      {numCheckers > 1 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Bot className="w-6 h-6 text-primary-600" />
            <h3 className="text-lg font-semibold text-gray-900">
              Người kiểm tra QA (QA 2..{numCheckers})
            </h3>
          </div>

          {Array.from({ length: numCheckers - 1 }).map((_, index) => {
            const v = verifiers[index] || { model: '', apiKey: '', prompt: '' }
            return (
              <div
                key={index}
                className="border border-gray-200 rounded-lg p-4 mb-4 last:mb-0"
              >
                <h4 className="font-semibold text-gray-900 mb-3">
                  Người QA {index + 2}
                </h4>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Model AI
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => updateVerifier(index, 'model', 'chatgpt')}
                        className={`p-3 border-2 rounded-lg transition-all ${
                          v.model === 'chatgpt'
                            ? 'border-primary-600 bg-primary-50'
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        <p className="font-medium text-gray-900">ChatGPT</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => updateVerifier(index, 'model', 'gemini')}
                        className={`p-3 border-2 rounded-lg transition-all ${
                          v.model === 'gemini'
                            ? 'border-primary-600 bg-primary-50'
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        <p className="font-medium text-gray-900">Gemini</p>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      API Key
                    </label>
                    <input
                      type="password"
                      value={v.apiKey}
                      onChange={(e) =>
                        updateVerifier(index, 'apiKey', e.target.value)
                      }
                      placeholder="Nhập API key"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Prompt
                      </label>
                      <button
                        type="button"
                        onClick={() => fillDefaultVerifierPrompt(index)}
                        className="text-xs px-2 py-1 bg-primary-50 text-primary-700 rounded border border-primary-200 hover:bg-primary-100"
                      >
                        Tự điền gợi ý
                      </button>
                    </div>
                    <textarea
                      value={v.prompt}
                      onChange={(e) =>
                        updateVerifier(index, 'prompt', e.target.value)
                      }
                      placeholder="Nhập prompt cho Người QA này..."
                      rows={4}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono text-sm"
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <div className="flex-shrink-0">
            <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          </div>
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
          onClick={startQA}
          disabled={starting || !qaConfig.apiKey || !qaConfig.prompt}
          className={`px-6 py-3 rounded-lg font-semibold transition-all ${
            starting || !qaConfig.apiKey || !qaConfig.prompt
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
            'Bắt đầu QA →'
          )}
        </button>
      </div>
    </div>
  )
}

export default QAConfiguration
