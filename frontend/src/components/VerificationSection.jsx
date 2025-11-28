/**
 * Component đối chiếu kết quả QA với 3 AI khác
 */

import React, { useState, useEffect } from 'react'
import { Loader, CheckCircle, AlertCircle, Pause, Play, Eye } from 'lucide-react'
import axios from 'axios'

const VerificationSection = ({ qaResult, onNext, onBack }) => {
  const [qaStatus, setQaStatus] = useState(null)
  const [error, setError] = useState(null)
  const [pausing, setPausing] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [showingResults, setShowingResults] = useState(false)
  const [partialResults, setPartialResults] = useState(null)
  const [resumeApiKey, setResumeApiKey] = useState('')
  const [resumingCheckpoint, setResumingCheckpoint] = useState(false)

  // Poll QA status
  useEffect(() => {
    if (!qaResult || !qaResult.qa_id) return

    const pollStatus = async () => {
      try {
        const response = await axios.get(`/api/qa/status/${qaResult.qa_id}`)
        setQaStatus(response.data)

        // Nếu chưa hoàn thành, tiếp tục poll
        if (response.data.status === 'processing') {
          setTimeout(pollStatus, 2000) // Poll mỗi 2 giây
        }
      } catch (err) {
        console.error('Error polling status:', err)
      }
    }

    pollStatus()
  }, [qaResult])

  // Pause QA
  const pauseQA = async () => {
    setPausing(true)
    setError(null)
    
    try {
      await axios.post(`/api/qa/pause/${qaResult.qa_id}`)
      // Refresh status
      const response = await axios.get(`/api/qa/status/${qaResult.qa_id}`)
      setQaStatus(response.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Lỗi khi tạm dừng QA')
    } finally {
      setPausing(false)
    }
  }

  // Resume QA
  const resumeQA = async () => {
    setResuming(true)
    setError(null)
    
    try {
      await axios.post(`/api/qa/resume/${qaResult.qa_id}`)
      // Refresh status
      const response = await axios.get(`/api/qa/status/${qaResult.qa_id}`)
      setQaStatus(response.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Lỗi khi tiếp tục QA')
    } finally {
      setResuming(false)
    }
  }

  // Resume QA từ checkpoint (sau khi backend restart)
  const resumeFromCheckpoint = async () => {
    if (!qaResult?.qa_id) return
    if (!resumeApiKey) {
      setError('Vui lòng nhập API key để tiếp tục QA từ checkpoint')
      return
    }

    setResumingCheckpoint(true)
    setError(null)

    try {
      await axios.post(`/api/qa/resume-from-checkpoint/${qaResult.qa_id}`, {
        api_key: resumeApiKey
      })

      const response = await axios.get(`/api/qa/status/${qaResult.qa_id}`)
      setQaStatus(response.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Lỗi khi tiếp tục QA từ checkpoint')
    } finally {
      setResumingCheckpoint(false)
    }
  }

  // View partial results
  const viewPartialResults = async () => {
    setShowingResults(true)
    setError(null)
    
    try {
      const response = await axios.get(`/api/qa/partial-results/${qaResult.qa_id}`)
      setPartialResults(response.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Lỗi khi lấy kết quả tạm thời')
    } finally {
      setShowingResults(false)
    }
  }

  const isQACompleted = qaStatus?.status === 'completed'
  const processedRows = qaStatus?.progress?.processed || 0
  const totalRows = qaStatus?.progress?.total || 0
  const MIN_ROWS_TO_VIEW = 50
  const canViewResults = isQACompleted || processedRows >= MIN_ROWS_TO_VIEW
  

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Bước 3: Theo Dõi QA
        </h2>
        <p className="text-gray-600">
          Theo dõi tiến trình QA, xem kết quả tạm thời và chuyển sang bước kết quả khi hoàn thành
        </p>
      </div>

      {/* QA Status */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Trạng thái QA ban đầu
        </h3>

        {!qaStatus ? (
          <div className="flex items-center space-x-3 text-gray-600">
            <Loader className="w-5 h-5 animate-spin" />
            <span>Đang tải trạng thái...</span>
          </div>
        ) : qaStatus.status === 'processing' ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3 text-primary-600">
                <Loader className="w-5 h-5 animate-spin" />
                <span className="font-medium">Đang xử lý QA...</span>
              </div>
              
              {/* Pause/Resume Controls */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={viewPartialResults}
                  disabled={showingResults}
                  className="px-3 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-all flex items-center space-x-2 disabled:opacity-50"
                >
                  {showingResults ? (
                    <Loader className="w-4 h-4 animate-spin" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                  <span className="text-sm">Xem kết quả</span>
                </button>
                
                <button
                  onClick={pauseQA}
                  disabled={pausing}
                  className="px-3 py-2 bg-orange-100 text-orange-700 rounded-md hover:bg-orange-200 transition-all flex items-center space-x-2 disabled:opacity-50"
                >
                  {pausing ? (
                    <Loader className="w-4 h-4 animate-spin" />
                  ) : (
                    <Pause className="w-4 h-4" />
                  )}
                  <span className="text-sm">Tạm dừng</span>
                </button>
              </div>
            </div>
            
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-primary-600 h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${(qaStatus.progress.processed / qaStatus.progress.total) * 100}%`
                }}
              />
            </div>
            <p className="text-sm text-gray-600">
              {qaStatus.progress.processed} / {qaStatus.progress.total} dòng đã xử lý
              {qaStatus.progress.processed > 0 && (
                <span className="ml-2 text-primary-600">
                  ({Math.round((qaStatus.progress.processed / qaStatus.progress.total) * 100)}%)
                </span>
              )}
            </p>
          </div>
        ) : qaStatus.status === 'paused' ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3 text-orange-600">
                <Pause className="w-5 h-5" />
                <span className="font-medium">QA đã tạm dừng</span>
              </div>
              
              {/* Resume Controls */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={viewPartialResults}
                  disabled={showingResults}
                  className="px-3 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-all flex items-center space-x-2 disabled:opacity-50"
                >
                  {showingResults ? (
                    <Loader className="w-4 h-4 animate-spin" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                  <span className="text-sm">Xem kết quả</span>
                </button>
                
                <button
                  onClick={resumeQA}
                  disabled={resuming}
                  className="px-3 py-2 bg-green-100 text-green-700 rounded-md hover:bg-green-200 transition-all flex items-center space-x-2 disabled:opacity-50"
                >
                  {resuming ? (
                    <Loader className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  <span className="text-sm">Tiếp tục</span>
                </button>
              </div>
            </div>
            
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-orange-500 h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${(qaStatus.progress.processed / qaStatus.progress.total) * 100}%`
                }}
              />
            </div>
            <p className="text-sm text-gray-600">
              Đã xử lý: {qaStatus.progress.processed} / {qaStatus.progress.total} dòng
              <span className="ml-2 text-orange-600">
                ({Math.round((qaStatus.progress.processed / qaStatus.progress.total) * 100)}%)
              </span>
            </p>
          </div>
        ) : qaStatus.status === 'completed' ? (
          <div className="flex items-center space-x-3 text-green-600">
            <CheckCircle className="w-6 h-6" />
            <span className="font-medium">QA hoàn thành! Có thể xem kết quả.</span>
          </div>
        ) : (
          <div className="flex items-center space-x-3 text-red-600">
            <AlertCircle className="w-6 h-6" />
            <span className="font-medium">QA thất bại</span>
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {/* Resume from checkpoint (sau restart backend) */}
      {qaStatus && qaStatus.status !== 'completed' && (
        <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 flex flex-col md:flex-row md:items-center md:justify-between space-y-3 md:space-y-0">
          <div>
            <p className="text-sm font-medium text-primary-800">
              Tiếp tục QA từ checkpoint (sau khi khởi động lại server)
            </p>
            <p className="text-xs text-primary-700 mt-1">
              Nhập lại API key để backend gọi model AI và chạy tiếp từ dòng đã xử lý.
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <input
              type="password"
              value={resumeApiKey}
              onChange={(e) => setResumeApiKey(e.target.value)}
              placeholder="API key"
              className="px-3 py-2 border border-primary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
            <button
              onClick={resumeFromCheckpoint}
              disabled={resumingCheckpoint || !resumeApiKey}
              className={`px-3 py-2 rounded-md text-sm font-medium flex items-center space-x-2 ${
                resumingCheckpoint || !resumeApiKey
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-primary-600 text-white hover:bg-primary-700'
              }`}
            >
              {resumingCheckpoint ? (
                <Loader className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              <span>Tiếp tục từ checkpoint</span>
            </button>
          </div>
        </div>
      )}

      {/* Partial Results Modal */}
      {partialResults && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-4xl max-h-[80vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">
                Kết Quả Tạm Thời ({partialResults.processed}/{partialResults.total})
              </h3>
              <button
                onClick={() => setPartialResults(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <div className="space-y-4">
                {/* Summary Stats */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div className="bg-green-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-green-600">
                      {partialResults.summary?.correct || 0}
                    </div>
                    <div className="text-sm text-green-700">Đúng</div>
                  </div>
                  <div className="bg-red-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-red-600">
                      {partialResults.summary?.incorrect || 0}
                    </div>
                    <div className="text-sm text-red-700">Sai</div>
                  </div>
                  <div className="bg-primary-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-primary-600">
                      {Math.round(((partialResults.summary?.correct || 0) / (partialResults.processed || 1)) * 100)}%
                    </div>
                    <div className="text-sm text-primary-700">Độ chính xác</div>
                  </div>
                </div>

                {/* Recent Results */}
                <div>
                  <h4 className="font-medium text-gray-900 mb-3">Kết quả gần nhất:</h4>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {partialResults.recent_results?.map((result, index) => (
                      <div
                        key={index}
                        className={`p-3 rounded-lg border ${
                          result.is_correct
                            ? 'bg-green-50 border-green-200'
                            : 'bg-red-50 border-red-200'
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-900">
                              Dòng {result.row_index}
                            </div>
                            <div className="text-xs text-gray-600 mt-1">
                              {result.explanation?.substring(0, 100)}...
                            </div>
                          </div>
                          <div className={`px-2 py-1 rounded text-xs font-medium ${
                            result.is_correct
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {result.is_correct ? '✓ Đúng' : '✗ Sai'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setPartialResults(null)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-all"
              >
                Đóng
              </button>
            </div>
          </div>
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
          onClick={onNext}
          disabled={!canViewResults}
          className={`px-6 py-3 rounded-lg font-semibold transition-all ${
            !canViewResults
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-primary-600 text-white hover:bg-primary-700 shadow-lg hover:shadow-xl'
          }`}
        >
          {isQACompleted
            ? 'Xem kết quả →'
            : canViewResults
            ? `Xem kết quả tạm thời (đã xử lý ${processedRows}/${totalRows}) →`
            : 'Đang QA...'}
        </button>
      </div>
    </div>
  )
}

export default VerificationSection
