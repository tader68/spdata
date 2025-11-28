/**
 * Hiển thị kết quả LABELING (Xử lý data)
 * Giống ResultsView nhưng đọc từ /api/label/result và /api/label/export.
 */

import React, { useState, useEffect } from 'react'
import { Download, Loader, AlertTriangle, RefreshCw } from 'lucide-react'
import axios from 'axios'

const LabelResultsView = ({ labelResult, onBack, onReset }) => {
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [previewMedia, setPreviewMedia] = useState(null)
  const [error, setError] = useState(null)
  const [resumeApiKey, setResumeApiKey] = useState('')
  const [resumingCheckpoint, setResumingCheckpoint] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    if (!labelResult || !labelResult.label_id) return

    let isCancelled = false
    let intervalId = null

    const loadResults = async () => {
      try {
        const response = await axios.get(`/api/label/result/${labelResult.label_id}`)
        if (isCancelled) return
        setResults(response.data)
        setLoading(false)

        if (response.data.status !== 'completed') {
          // Tiếp tục poll cho đến khi completed
          if (!intervalId) {
            intervalId = setInterval(loadResults, 3000)
          }
        } else if (intervalId) {
          clearInterval(intervalId)
          intervalId = null
        }
      } catch (err) {
        console.error('Error loading label results:', err)
        setLoading(false)
        setError(err.response?.data?.error || 'Lỗi khi tải kết quả labeling')
      }
    }

    loadResults()

    return () => {
      isCancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [labelResult])

  useEffect(() => {
    if (results && Array.isArray(results.results)) {
      setCurrentPage(1)
    }
  }, [results])

  const exportResults = async () => {
    setExporting(true)
    try {
      const response = await axios.get(`/api/label/export/${labelResult.label_id}`, {
        responseType: 'blob'
      })

      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `label_result_${labelResult.label_id}.xlsx`)
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (err) {
      console.error('Error exporting label results:', err)
    } finally {
      setExporting(false)
    }
  }

  const resumeFromCheckpoint = async () => {
    if (!labelResult?.label_id) return
    if (!resumeApiKey) {
      setError('Vui lòng nhập API key để tiếp tục Label từ checkpoint')
      return
    }

    setResumingCheckpoint(true)
    setError(null)

    try {
      await axios.post(`/api/label/resume-from-checkpoint/${labelResult.label_id}`, {
        api_key: resumeApiKey
      })

      const response = await axios.get(`/api/label/result/${labelResult.label_id}`)
      setResults(response.data)
      setLoading(false)
    } catch (err) {
      console.error('Error resuming label from checkpoint:', err)
      setError(err.response?.data?.error || 'Lỗi khi tiếp tục Label từ checkpoint')
    } finally {
      setResumingCheckpoint(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader className="w-12 h-12 text-primary-600 animate-spin mb-4" />
        <p className="text-gray-600">Đang tải kết quả labeling...</p>
      </div>
    )
  }

  const total = results?.results?.length || 0
  const noErrorCount = results?.results?.filter(r => !r.errors || r.errors.length === 0).length || 0
  const errorCount = total - noErrorCount
  const processedRows = results?.processed_rows ?? total
  const totalRows = results?.total_rows ?? total

  const PAGE_SIZE = 50
  const totalResults = total
  const totalPages = totalResults > 0 ? Math.ceil(totalResults / PAGE_SIZE) : 1
  const startIndex = totalResults === 0 ? 0 : (currentPage - 1) * PAGE_SIZE
  const endIndex = totalResults === 0 ? 0 : Math.min(startIndex + PAGE_SIZE, totalResults)
  const paginatedResults = totalResults > 0 ? results.results.slice(startIndex, endIndex) : []

  const renderDataRaw = (result) => {
    const rowData = result?.row_data || {}
    const media = result?.media
    const hasRowData = rowData && Object.keys(rowData).length > 0

    if (media && media.batch_id && media.filename) {
      const src = `/api/media/${encodeURIComponent(media.batch_id)}/${encodeURIComponent(media.filename)}`

      const meta = hasRowData ? (
        <pre className="mt-2 text-xs bg-gray-50 p-2 rounded border overflow-x-auto">
          {JSON.stringify(rowData, null, 2)}
        </pre>
      ) : null

      if (media.type === 'image') {
        return (
          <div className="space-y-2">
            <img
              src={src}
              alt={media.filename}
              className="max-h-40 rounded border cursor-pointer hover:shadow-lg"
              onClick={() =>
                setPreviewMedia({
                  type: 'image',
                  src,
                  filename: media.filename
                })
              }
            />
            {meta}
          </div>
        )
      }

      if (media.type === 'audio') {
        return (
          <div className="space-y-2">
            <audio controls src={src} className="w-full" />
            {meta}
          </div>
        )
      }

      if (media.type === 'video') {
        return (
          <div className="space-y-2">
            <video controls src={src} className="max-h-40 rounded border" />
            {meta}
          </div>
        )
      }
    }

    if (hasRowData) {
      return (
        <pre className="text-xs bg-gray-50 p-2 rounded border overflow-x-auto">
          {JSON.stringify(rowData, null, 2)}
        </pre>
      )
    }

    return <span className="text-gray-400">Không có dữ liệu</span>
  }

  const renderLabels = (labels) => {
    if (!labels || Object.keys(labels).length === 0) {
      return <span className="text-gray-400">Chưa có label</span>
    }

    return (
      <pre className="text-xs bg-gray-50 p-2 rounded border overflow-x-auto">
        {JSON.stringify(labels, null, 2)}
      </pre>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Kết Quả Labeling
        </h2>
        <p className="text-gray-600">Xem các label AI đã gán cho dữ liệu của bạn.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start space-x-3">
          <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
          <div>
            <p className="text-sm text-red-800">{error}</p>
          </div>
        </div>
      )}

      {!results && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start space-x-3">
          <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
          <div>
            <p className="text-sm text-yellow-800 font-medium">Không tìm thấy kết quả cho job labeling này.</p>
            <p className="text-sm text-yellow-700 mt-1">
              Có thể job vẫn đang chạy hoặc file kết quả đã bị xóa. Bạn có thể quay lại để cấu hình và chạy lại.
            </p>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <p className="text-sm text-gray-600 mb-1">Tổng số dòng</p>
          <p className="text-3xl font-bold text-gray-900">{total}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <p className="text-sm text-gray-600 mb-1">Label thành công (không có lỗi hệ thống)</p>
          <p className="text-3xl font-bold text-green-600">{noErrorCount}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <p className="text-sm text-gray-600 mb-1">Dòng lỗi (timeout/quota/...)</p>
          <p className="text-3xl font-bold text-red-600">{errorCount}</p>
        </div>
      </div>

      {results && results.status !== 'completed' && (
        <div className="mt-2 text-sm text-gray-600">
          Trạng thái hiện tại: <strong>{results.status}</strong> – Đã xử lý {processedRows}/{totalRows} dòng.
        </div>
      )}

      {/* Resume from checkpoint (sau restart backend) */}
      {results && results.status !== 'completed' && (
        <div className="mt-4 bg-primary-50 border border-primary-200 rounded-lg p-4 flex flex-col md:flex-row md:items-center md:justify-between space-y-3 md:space-y-0">
          <div>
            <p className="text-sm font-medium text-primary-800">
              Tiếp tục Labeling từ checkpoint (sau khi khởi động lại server)
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
                <RefreshCw className="w-4 h-4" />
              )}
              <span>Tiếp tục từ checkpoint</span>
            </button>
          </div>
        </div>
      )}

      {/* Results table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900">Chi tiết kết quả</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  STT
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Dữ liệu gốc
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Labels
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Giải thích
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Lỗi
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {paginatedResults.map((result, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {startIndex + index + 1}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {renderDataRaw(result)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {renderLabels(result.labels)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {result.explanation ? (
                      <span className="text-xs whitespace-pre-line">
                        {String(result.explanation).slice(0, 300)}
                        {String(result.explanation).length > 300 ? '...' : ''}
                      </span>
                    ) : (
                      <span className="text-gray-400">Không có giải thích</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {result.errors?.length > 0 ? (
                      <ul className="list-disc list-inside text-xs text-red-600">
                        {result.errors.slice(0, 3).map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-gray-400">Không có lỗi</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalResults > 0 && (
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-sm text-gray-600">
            <div>
              Hiển thị {startIndex + 1}-{endIndex}/{totalResults} kết quả.
            </div>
            {totalPages > 1 && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className={`px-3 py-1 rounded border text-xs font-medium ${
                    currentPage === 1
                      ? 'text-gray-400 border-gray-200 cursor-not-allowed'
                      : 'text-gray-700 border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  Trang trước
                </button>
                <span>
                  Trang {currentPage}/{totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className={`px-3 py-1 rounded border text-xs font-medium ${
                    currentPage === totalPages
                      ? 'text-gray-400 border-gray-200 cursor-not-allowed'
                      : 'text-gray-700 border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  Trang sau
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-3 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 transition-all"
        >
          ← Quay lại
        </button>

        <div className="flex space-x-4">
          <button
            onClick={exportResults}
            disabled={exporting}
            className={`flex items-center space-x-2 px-6 py-3 rounded-lg font-semibold transition-all ${
              exporting
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-primary-600 text-white hover:bg-primary-700 shadow-lg hover:shadow-xl'
            }`}
          >
            {exporting ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                <span>Đang export...</span>
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                <span>Export Excel</span>
              </>
            )}
          </button>

          <button
            onClick={onReset}
            className="flex items-center space-x-2 px-6 py-3 bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-700 shadow-lg hover:shadow-xl transition-all"
          >
            <RefreshCw className="w-5 h-5" />
            <span>Label mới</span>
          </button>
        </div>
      </div>

      {previewMedia && previewMedia.type === 'image' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75"
          onClick={() => setPreviewMedia(null)}
        >
          <div
            className="max-w-5xl max-h-[90vh] mx-4 flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={previewMedia.src}
              alt={previewMedia.filename}
              className="max-h-[85vh] rounded shadow-2xl"
            />
            <button
              onClick={() => setPreviewMedia(null)}
              className="mt-4 px-4 py-2 rounded bg-white text-gray-800 text-sm font-medium shadow hover:bg-gray-100"
            >
              Đóng
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default LabelResultsView
