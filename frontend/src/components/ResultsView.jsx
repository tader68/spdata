/**
 * Component hiển thị kết quả QA và Verification
 * Cho phép xem chi tiết và export
 */

import React, { useState, useEffect } from 'react'
import { Download, Loader, CheckCircle, XCircle, AlertTriangle, RefreshCw } from 'lucide-react'
import axios from 'axios'

const ResultsView = ({ qaResult, verificationResult, onBack, onReset }) => {
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [previewMedia, setPreviewMedia] = useState(null) // Xem ảnh lớn
  const [currentPage, setCurrentPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('all') // all | correct | incorrect | uncertain
  const [sortOption, setSortOption] = useState('none') // none | correctFirst | incorrectFirst | uncertainFirst

  // Load results
  useEffect(() => {
    const loadResults = async () => {
      try {
        const jobId = verificationResult?.verification_id || qaResult?.qa_id
        if (!jobId) return

        const response = await axios.get(`/api/qa/result/${jobId}`)
        setResults(response.data)
      } catch (err) {
        console.error('Error loading results:', err)
      } finally {
        setLoading(false)
      }
    }

    loadResults()
    
    // Poll nếu đang processing
    const interval = setInterval(() => {
      if (verificationResult?.status === 'processing' || qaResult?.status === 'processing') {
        loadResults()
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [qaResult, verificationResult])

  useEffect(() => {
    if (results && Array.isArray(results.results)) {
      setCurrentPage(1)
    }
  }, [results, statusFilter, sortOption])

  // Export results
  const exportResults = async () => {
    setExporting(true)
    try {
      const jobId = verificationResult?.verification_id || qaResult?.qa_id
      const response = await axios.get(`/api/qa/export/${jobId}`, {
        responseType: 'blob'
      })

      // Tạo link download
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `qa_result_${jobId}.xlsx`)
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (err) {
      console.error('Error exporting:', err)
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader className="w-12 h-12 text-primary-600 animate-spin mb-4" />
        <p className="text-gray-600">Đang tải kết quả...</p>
      </div>
    )
  }

  const allResults = Array.isArray(results?.results) ? results.results : []

  // Tính toán thống kê tổng
  const stats = {
    total: allResults.length || 0,
    correct: allResults.filter(r => r.is_correct === true).length || 0,
    incorrect: allResults.filter(r => r.is_correct === false).length || 0,
    uncertain: allResults.filter(r => r.is_correct === null).length || 0
  }

  // Lọc theo trạng thái
  const filteredResults = allResults.filter((r) => {
    if (statusFilter === 'correct') return r.is_correct === true
    if (statusFilter === 'incorrect') return r.is_correct === false
    if (statusFilter === 'uncertain') return r.is_correct === null
    return true
  })

  // Sort theo trạng thái
  const getStatusKey = (isCorrect) => {
    if (isCorrect === true) return 'correct'
    if (isCorrect === false) return 'incorrect'
    return 'uncertain'
  }

  const getSortWeight = (isCorrect) => {
    const key = getStatusKey(isCorrect)
    if (sortOption === 'correctFirst') {
      const order = { correct: 0, incorrect: 1, uncertain: 2 }
      return order[key]
    }
    if (sortOption === 'incorrectFirst') {
      const order = { incorrect: 0, correct: 1, uncertain: 2 }
      return order[key]
    }
    if (sortOption === 'uncertainFirst') {
      const order = { uncertain: 0, incorrect: 1, correct: 2 }
      return order[key]
    }
    return 0
  }

  const sortedResults = [...filteredResults]
  if (sortOption !== 'none') {
    sortedResults.sort((a, b) => {
      return getSortWeight(a.is_correct) - getSortWeight(b.is_correct)
    })
  }

  const PAGE_SIZE = 50
  const totalResults = sortedResults.length
  const totalPages = totalResults > 0 ? Math.ceil(totalResults / PAGE_SIZE) : 1
  const startIndex = totalResults === 0 ? 0 : (currentPage - 1) * PAGE_SIZE
  const endIndex = totalResults === 0 ? 0 : Math.min(startIndex + PAGE_SIZE, totalResults)
  const paginatedResults = totalResults > 0 ? sortedResults.slice(startIndex, endIndex) : []

  const accuracyRate = stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(1) : 0

  // Số lượng verifier thực tế (nếu có verification)
  const verifierCount = results?.verification?.verification_results?.[0]?.verifier_results?.length || 0

  const renderMedia = (result) => {
    const media = result?.media
    if (!media || !media.batch_id || !media.filename) {
      return <span className="text-gray-400">Không có media</span>
    }

    const apiBase = axios.defaults.baseURL || ''
    const src = `${apiBase}/api/media/${encodeURIComponent(media.batch_id)}/${encodeURIComponent(media.filename)}`

    if (media.type === 'image') {
      return (
        <img
          src={src}
          alt={media.filename}
          className="max-h-64 rounded border cursor-pointer hover:shadow-lg"
          onClick={() =>
            setPreviewMedia({
              type: 'image',
              src,
              filename: media.filename
            })
          }
        />
      )
    }

    if (media.type === 'audio') {
      return <audio controls src={src} className="w-full" />
    }

    if (media.type === 'video') {
      return <video controls src={src} className="max-h-64 rounded border" />
    }

    return <span className="text-gray-400">Không hỗ trợ media này</span>
  }

  const renderRowData = (result) => {
    const rowData = result?.row_data || {}
    const hasRowData = rowData && Object.keys(rowData).length > 0

    if (hasRowData) {
      return (
        <pre className="text-xs bg-gray-50 p-2 rounded border overflow-x-auto">
          {JSON.stringify(rowData, null, 2)}
        </pre>
      )
    }

    return <span className="text-gray-400">Không có dữ liệu</span>
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Bước 4: Kết Quả QA
        </h2>
        <p className="text-gray-600">
          Xem chi tiết kết quả và export báo cáo
        </p>
      </div>

      {/* Thông báo khi không tìm thấy kết quả */}
      {!results && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start space-x-3">
          <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
          <div>
            <p className="text-sm text-yellow-800 font-medium">Không tìm thấy kết quả cho phiên QA này.</p>
            <p className="text-sm text-yellow-700 mt-1">
              Có thể QA chưa chạy xong hoặc file kết quả đã bị xóa. Bạn có thể bấm "← Quay lại" để cấu hình và chạy lại QA cho project này.
            </p>
          </div>
        </div>
      )}

      {/* Summary Statistics */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Tổng số</p>
              <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-2xl">📊</span>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Đúng</p>
              <p className="text-3xl font-bold text-green-600">{stats.correct}</p>
            </div>
            <CheckCircle className="w-12 h-12 text-green-600" />
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Sai</p>
              <p className="text-3xl font-bold text-red-600">{stats.incorrect}</p>
            </div>
            <XCircle className="w-12 h-12 text-red-600" />
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Độ chính xác</p>
              <p className="text-3xl font-bold text-primary-600">{accuracyRate}%</p>
            </div>
            <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
              <span className="text-2xl">✓</span>
            </div>
          </div>
        </div>
      </div>

      {/* Verification Info */}
      {results?.verification && (
        <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-purple-900 mb-2">
            {verifierCount > 0
              ? `Đã đối chiếu với ${verifierCount} AI verifier`
              : 'Đã đối chiếu lại kết quả QA'}
          </h3>
          <p className="text-purple-700">
            Kết quả đã được kiểm tra lại bởi các model AI khác để tăng độ tin cậy và phát hiện sai sót.
          </p>
        </div>
      )}

      {/* Results Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex flex-col md:flex-row md:items-center md:justify-between space-y-3 md:space-y-0">
          <h3 className="text-lg font-semibold text-gray-900">
            Chi tiết kết quả
          </h3>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center space-x-2">
              <span className="text-gray-600">Lọc trạng thái:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded-md text-xs bg-white"
              >
                <option value="all">Tất cả</option>
                <option value="correct">Đúng</option>
                <option value="incorrect">Sai</option>
                <option value="uncertain">Không rõ</option>
              </select>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-gray-600">Sắp xếp:</span>
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded-md text-xs bg-white"
              >
                <option value="none">Không sắp xếp</option>
                <option value="correctFirst">Đúng trước</option>
                <option value="incorrectFirst">Sai trước</option>
                <option value="uncertainFirst">Không rõ trước</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full table-fixed">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                  STT
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-28">
                  Trạng thái
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-96">
                  Media
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-64">
                  Dữ liệu gốc
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-56">
                  Lỗi
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-56">
                  Gợi ý
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {paginatedResults.map((result, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-900 align-top">
                    {startIndex + index + 1}
                  </td>
                  <td className="px-6 py-5 whitespace-nowrap align-top">
                    {result.is_correct === true ? (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Đúng
                      </span>
                    ) : result.is_correct === false ? (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
                        <XCircle className="w-4 h-4 mr-1" />
                        Sai
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800">
                        <AlertTriangle className="w-4 h-4 mr-1" />
                        Không rõ
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-5 text-sm text-gray-900 align-top">
                    {renderMedia(result)}
                  </td>
                  <td className="px-6 py-5 text-sm text-gray-900 align-top">
                    {renderRowData(result)}
                  </td>
                  <td className="px-6 py-5 text-sm text-gray-900 align-top">
                    {result.errors?.length > 0 ? (
                      <ul className="list-disc list-inside">
                        {result.errors.slice(0, 2).map((error, i) => (
                          <li key={i} className="text-red-600">{error}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-gray-400">Không có lỗi</span>
                    )}
                  </td>
                  <td className="px-6 py-5 text-sm text-gray-900 align-top">
                    {result.suggestions?.length > 0 ? (
                      <ul className="list-disc list-inside">
                        {result.suggestions.slice(0, 2).map((suggestion, i) => (
                          <li key={i} className="text-primary-600">{suggestion}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-gray-400">Không có gợi ý</span>
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

      {/* Action Buttons */}
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
            <span>QA mới</span>
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

export default ResultsView
