import React, { useState, useEffect, useRef } from 'react'
import { Upload, FileText, CheckCircle, AlertTriangle, Loader, Table, Download } from 'lucide-react'
import axios from 'axios'

const CompareData = ({ initialProject }) => {
  const [datasets, setDatasets] = useState([]) // {id, label, file, info, uploading, error}
  const [fileInputKey, setFileInputKey] = useState(0)
  const [error, setError] = useState(null)

  const [guideline, setGuideline] = useState(null) // {file, info}
  const [uploadingGuideline, setUploadingGuideline] = useState(false)

  const [mediaInfo, setMediaInfo] = useState(null) // {files, info}
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [mediaColumn, setMediaColumn] = useState('')

  const [idColumn, setIdColumn] = useState('')
  const [compareColumns, setCompareColumns] = useState([])
  const [referenceIndex, setReferenceIndex] = useState(0)

  const [starting, setStarting] = useState(false)
  const [compareJob, setCompareJob] = useState(null) // {compare_id, status}
  const [compareStatus, setCompareStatus] = useState(null)
  const [compareResult, setCompareResult] = useState(null)
  const [loadingResult, setLoadingResult] = useState(false)

  const [overrides, setOverrides] = useState({}) // id_value -> {col: value}
  const [exporting, setExporting] = useState(false)

  const [currentPage, setCurrentPage] = useState(1)
  const PAGE_SIZE = 50

  const [previewMedia, setPreviewMedia] = useState(null)

  const [rowStatusFilter, setRowStatusFilter] = useState('all') // 'all' | 'equal' | 'diff'
  const [rowSortOption, setRowSortOption] = useState('none') // 'none' | 'fewDiffFirst' | 'manyDiffFirst'
  const [colSummarySort, setColSummarySort] = useState('diffDesc') // 'none' | 'diffDesc' | 'diffAsc'
  const [columnFilterKey, setColumnFilterKey] = useState('')
  const [columnFilterValue, setColumnFilterValue] = useState('')
  const [mediaFilter, setMediaFilter] = useState('all') // 'all' | 'has' | 'none'

  const [projectData, setProjectData] = useState({
    name: '',
    description: '',
    created_by: '',
    project_id: null,
    saved: false
  })
  const [savingProject, setSavingProject] = useState(false)
  const [projectError, setProjectError] = useState(null)

  const [currentUser, setCurrentUser] = useState(null)

  const mediaFolderInputRef = useRef(null)

  const [compareTemplates, setCompareTemplates] = useState([])
  const [loadingCompareTemplates, setLoadingCompareTemplates] = useState(false)

  const maxFiles = 5

  const firstColumns = datasets[0]?.info?.columns || []

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
    if (!projectData.name && datasets.length > 0) {
      const first = datasets[0]
      const rawName = first.file?.name || first.info?.file_name
      if (!rawName) return

      const now = new Date()
      const dateStr = now.toLocaleDateString('vi-VN')
      const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
      const cleanName = rawName.replace(/\.[^/.]+$/, '')
      const defaultName = `Compare ${cleanName} - ${dateStr} ${timeStr}`
      setProjectData((prev) => ({ ...prev, name: defaultName }))
    }
  }, [datasets, projectData.name])

  const reloadCompareTemplates = async () => {
    try {
      setLoadingCompareTemplates(true)
      const resp = await axios.get('/api/projects')
      const projects = resp.data?.projects || []
      const compares = projects.filter((p) => {
        const type = (p.project_type || '').toLowerCase()
        if (type === 'compare') return true
        // Fallback: nếu có compare_config mà type chưa set chuẩn
        if (!type && p.compare_config) return true
        return false
      })
      setCompareTemplates(compares)
    } catch (e) {
      console.error('[Compare] Lỗi load danh sách project Compare:', e)
    } finally {
      setLoadingCompareTemplates(false)
    }
  }

  // Áp dụng cấu hình Compare từ một project
  // options.attachLastCompare = true: dùng khi mở từ Projects (để load lại kết quả cũ)
  // options.keepProjectMeta = true: giữ nguyên metadata project (tên/mô tả/người tạo/project_id)
  const applyCompareProjectConfig = (project, options = {}) => {
    if (!project || project.project_type !== 'compare') return

    const cfg = project.compare_config || {}

    // Reset kết quả cũ
    setCompareResult(null)
    setCompareJob(null)
    setCompareStatus(null)
    setOverrides({})
    setCurrentPage(1)

    // Prefill cấu hình cột
    const idCol = cfg.id_column || cfg.idColumn || ''
    const cols = cfg.compare_columns || cfg.compareColumns || []
    const refIdxRaw = cfg.reference_index ?? cfg.referenceIndex ?? 0
    const mediaCol = cfg.media_column || cfg.mediaColumn || ''

    if (idCol) setIdColumn(idCol)
    if (Array.isArray(cols) && cols.length > 0) setCompareColumns(cols)
    const refIdxNum = Number(refIdxRaw)
    setReferenceIndex(Number.isNaN(refIdxNum) ? 0 : refIdxNum)
    setMediaColumn(mediaCol || '')

    // Prefill datasets từ datasets_info
    const primaryColumns = project.data_info?.columns || []
    const primaryRows = project.data_info?.rows
    const primaryFileName = project.data_info?.file_name

    const dsInfo = cfg.datasets_info || []
    const newDatasets = dsInfo
      .map((ds, idx) => {
        const fileId = ds.file_id || ds.data_id || ds.fileId || ds.dataId
        if (!fileId) return null
        return {
          id: `ds_project_${project.project_id}_${idx}`,
          label: ds.label || `File ${idx + 1}`,
          file: null,
          info: {
            file_id: fileId,
            file_name: ds.file_name || (idx === 0 ? primaryFileName : undefined),
            rows: ds.rows ?? (idx === 0 ? primaryRows : undefined),
            columns: ds.columns || primaryColumns,
            preview: ds.preview || [],
          },
          uploading: false,
          error: null,
        }
      })
      .filter(Boolean)
      .slice(0, maxFiles)

    if (newDatasets.length >= 2) {
      setDatasets(newDatasets)
    }

    // Prefill guideline/media từ project
    if (project.guideline_info) {
      setGuideline({
        file: null,
        info: {
          file_id: project.guideline_info.file_id,
          file_name: project.guideline_info.file_name,
        },
      })
    } else {
      setGuideline(null)
    }

    if (project.media_info) {
      setMediaInfo({
        files: [],
        info: {
          batch_id: project.media_info.batch_id,
          files: project.media_info.files || [],
        },
      })
    } else {
      setMediaInfo(null)
    }

    // Metadata project:
    // - Nếu keepProjectMeta=true (mở từ Projects) thì giữ lại thông tin project cũ.
    // - Nếu không, reset form để user tạo project Compare mới (chỉ reuse cấu hình cột + file).
    if (options.keepProjectMeta) {
      setProjectData({
        name: project.name,
        description: project.description,
        created_by: project.created_by,
        project_id: project.project_id,
        saved: true,
      })
    } else {
      setProjectData({
        name: '',
        description: '',
        created_by: '',
        project_id: null,
        saved: false,
      })
    }

    // Nếu project đã có compare run và được yêu cầu, gắn compareJob để load lại kết quả
    if (options.attachLastCompare && project.last_compare_id) {
      setCompareJob({
        compare_id: project.last_compare_id,
        status: project.status || 'completed',
      })
    }
  }

  // Prefill từ project Compare khi mở từ Projects
  useEffect(() => {
    if (!initialProject || initialProject.project_type !== 'compare') return
    applyCompareProjectConfig(initialProject, { attachLastCompare: true, keepProjectMeta: true })
  }, [initialProject])

  // Load danh sách project Compare để reuse cấu hình
  useEffect(() => {
    reloadCompareTemplates()
  }, [])

  const applyCompareTemplate = async (projectId) => {
    if (!projectId) return
    try {
      setProjectError(null)
      const resp = await axios.get(`/api/projects/${projectId}`)
      const project = resp.data?.project
      if (!project || project.project_type !== 'compare') {
        setProjectError('Project đã chọn không phải Compare data')
        return
      }
      // Reuse cấu hình nhưng KHÔNG auto load lại kết quả cũ và KHÔNG reuse metadata project
      applyCompareProjectConfig(project, { attachLastCompare: false, keepProjectMeta: false })
    } catch (e) {
      console.error('[Compare] Lỗi khi dùng lại cấu hình Compare từ project:', e)
      setProjectError(e?.response?.data?.error || e.message || 'Lỗi khi dùng lại cấu hình Compare từ project')
    }
  }

  const handleAddDataset = async (event) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return

    setFileInputKey((k) => k + 1)

    const availableSlots = maxFiles - datasets.length
    if (availableSlots <= 0) {
      setError(`Tối đa ${maxFiles} file để so sánh.`)
      return
    }

    const filesToUpload = files.slice(0, availableSlots)
    if (files.length > availableSlots) {
      setError(`Tối đa ${maxFiles} file để so sánh. Đã bỏ qua ${files.length - availableSlots} file.`)
    } else {
      setError(null)
    }

    for (const file of filesToUpload) {
      const newId = `ds_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      // Thêm placeholder dataset
      setDatasets((prev) => {
        const idx = prev.length
        const newItem = {
          id: newId,
          label: `File ${idx + 1}`,
          file,
          info: null,
          uploading: true,
          error: null
        }
        return [...prev, newItem]
      })

      try {
        const formData = new FormData()
        formData.append('file', file)

        const resp = await axios.post('/api/upload/data', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
            Accept: 'application/json'
          }
        })

        let payload = resp.data
        if (typeof payload === 'string') {
          try {
            payload = JSON.parse(payload)
          } catch (e) {
            throw new Error('Không thể parse response từ server khi upload data')
          }
        }

        const info = {
          file_id: payload.file_id,
          rows: payload.rows,
          columns: payload.columns || [],
          preview: payload.preview || []
        }

        setDatasets((prev) =>
          prev.map((ds) =>
            ds.id === newId
              ? {
                  ...ds,
                  info,
                  uploading: false,
                  error: null
                }
              : ds
          )
        )

        if (!idColumn && Array.isArray(info.columns) && info.columns.length > 0) {
          setIdColumn(info.columns[0])
          setCompareColumns(info.columns.slice(1, Math.min(info.columns.length, 6)))
        }
      } catch (e) {
        const msg = e?.response?.data?.error || e.message || 'Lỗi upload file data'
        setDatasets((prev) =>
          prev.map((ds) =>
            ds.id === newId
              ? {
                  ...ds,
                  uploading: false,
                  error: msg
                }
              : ds
          )
        )
      }
    }

    if (event.target) {
      event.target.value = ''
    }
  }

  const handleGuidelineChange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    setError(null)
    setUploadingGuideline(true)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const resp = await axios.post('/api/upload/guideline', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })

      setGuideline({
        file,
        info: resp.data
      })
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Lỗi upload guideline')
    } finally {
      setUploadingGuideline(false)
      if (event.target) {
        event.target.value = ''
      }
    }
  }

  const handleMediaChange = async (event) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return

    setError(null)
    setUploadingMedia(true)

    try {
      const formData = new FormData()
      files.forEach((f) => formData.append('files', f))

      const resp = await axios.post('/api/upload/media', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })

      setMediaInfo({
        files,
        info: resp.data
      })
    } catch (e) {
      console.error('[Compare] Lỗi upload media:', e)
      setError(e?.response?.data?.error || e.message || 'Lỗi upload media')
    } finally {
      setUploadingMedia(false)
      if (event.target) {
        event.target.value = ''
      }
    }
  }

  const handleRemoveDataset = (id) => {
    setDatasets((prev) => prev.filter((ds) => ds.id !== id))
    setCompareResult(null)
    setCompareJob(null)
    setCompareStatus(null)
    setOverrides({})
  }

  const handleLabelChange = (id, value) => {
    setDatasets((prev) =>
      prev.map((ds) =>
        ds.id === id
          ? {
              ...ds,
              label: value
            }
          : ds
      )
    )
  }

  const toggleCompareColumn = (col) => {
    setCompareColumns((prev) => {
      if (prev.includes(col)) return prev.filter((c) => c !== col)
      return [...prev, col]
    })
  }

  const canStartCompare =
    datasets.length >= 1 &&
    datasets.every((ds) => ds.info && !ds.uploading) &&
    firstColumns.length > 0 &&
    idColumn &&
    compareColumns.length > 0

  const handleSaveProject = async () => {
    if (!projectData.name?.trim()) {
      setProjectError('Vui lòng nhập tên project')
      return
    }
    if (datasets.length === 0) {
      setProjectError('Vui lòng upload ít nhất 1 file data trước khi tạo project')
      return
    }

    if (!currentUser) {
      setProjectError('Không xác định được user hiện tại, vui lòng đăng nhập lại.')
      return
    }

    const role = (currentUser.role || '').toLowerCase()
    const isOwner = role === 'owner'
    const perms = currentUser.permissions || []
    const canCreate = isOwner || perms.includes('create_project')
    if (!canCreate) {
      setProjectError('Bạn không có quyền tạo project Compare.')
      return
    }

    try {
      setSavingProject(true)
      setProjectError(null)

      const primary = datasets[0]
      const compareConfig = {
        id_column: idColumn,
        compare_columns: compareColumns,
        reference_index: referenceIndex,
        media_column: mediaColumn || null,
        datasets_info: datasets.map((ds, idx) => ({
          file_id: ds.info?.file_id,
          label: ds.label || `File ${idx + 1}`
        }))
      }

      const payload = {
        name: projectData.name.trim(),
        description: projectData.description?.trim() || '',
        created_by: projectData.created_by?.trim() || 'Anonymous',
        project_type: 'compare',
        data_info: {
          file_id: primary.info?.file_id,
          file_name: primary.file?.name || primary.info?.file_name,
          rows: primary.info?.rows,
          columns: primary.info?.columns?.length || 0
        },
        guideline_info: guideline
          ? {
              file_id: guideline.info?.file_id,
              file_name: guideline.file?.name || guideline.info?.file_name
            }
          : null,
        media_info: mediaInfo
          ? {
              batch_id: mediaInfo.info?.batch_id,
              file_count: mediaInfo.info?.files?.length || 0,
              files: mediaInfo.info?.files || []
            }
          : null,
        created_at: new Date().toISOString(),
        compare_config: compareConfig
      }

      const resp = await axios.post('/api/projects/create', payload, {
        headers: {
          'X-Current-User': currentUser.username
        }
      })

      setProjectData((prev) => ({
        ...prev,
        project_id: resp.data.project_id,
        saved: true
      }))

      // Sau khi tạo project Compare mới, reload lại danh sách template để dropdown có ngay
      reloadCompareTemplates()
    } catch (e) {
      setProjectError(e?.response?.data?.error || e.message || 'Lỗi khi lưu project Compare')
    } finally {
      setSavingProject(false)
    }
  }

  const handleStartCompare = async () => {
    if (!canStartCompare) return

    try {
      setStarting(true)
      setError(null)
      setCompareResult(null)
      setCompareJob(null)
      setCompareStatus(null)
      setOverrides({})

      const payload = {
        datasets: datasets.map((ds) => ({
          data_id: ds.info.file_id,
          label: ds.label
        })),
        id_column: idColumn,
        compare_columns: compareColumns,
        reference_index: referenceIndex,
        guideline_id: guideline?.info?.file_id,
        media_batch_id: mediaInfo?.info?.batch_id,
        media_column: mediaColumn || null,
        project_id: projectData.project_id
      }

      const resp = await axios.post('/api/compare/start', payload)
      setCompareJob({
        compare_id: resp.data.compare_id,
        status: resp.data.status
      })
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Lỗi khi bắt đầu job Compare')
    } finally {
      setStarting(false)
    }
  }

  useEffect(() => {
    if (!compareJob?.compare_id) return

    let cancelled = false

    const fetchStatusAndMaybeResult = async () => {
      try {
        const statusResp = await axios.get(`/api/compare/status/${compareJob.compare_id}`)
        if (cancelled) return
        setCompareStatus(statusResp.data)

        const status = statusResp.data?.status
        if (status === 'completed' && !compareResult && !loadingResult) {
          setLoadingResult(true)
          try {
            const resultResp = await axios.get(`/api/compare/result/${compareJob.compare_id}`)
            if (!cancelled) {
              setCompareResult(resultResp.data)
            }
          } finally {
            if (!cancelled) setLoadingResult(false)
          }
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[Compare] Lỗi khi lấy trạng thái compare:', e)
        }
      }
    }

    fetchStatusAndMaybeResult()
    const interval = setInterval(fetchStatusAndMaybeResult, 3000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [compareJob?.compare_id])

  const getEffectiveFinalValue = (row, col) => {
    const idValue = row.id_value
    const base = row.final_values?.[col]
    const rowOverride = overrides[idValue]
    if (rowOverride && Object.prototype.hasOwnProperty.call(rowOverride, col)) {
      return rowOverride[col]
    }
    return base
  }

  const handleFinalChange = (row, col, value) => {
    const idValue = row.id_value
    setOverrides((prev) => {
      const prevRow = prev[idValue] || {}

      // Nếu value null/undefined: xoá override cho cột này, trả về giá trị chuẩn
      if (value === null || value === undefined) {
        const { [col]: _removed, ...restCols } = prevRow
        if (Object.keys(restCols).length === 0) {
          const { [idValue]: _removedRow, ...restRows } = prev
          return restRows
        }
        return {
          ...prev,
          [idValue]: restCols
        }
      }

      return {
        ...prev,
        [idValue]: {
          ...prevRow,
          [col]: value
        }
      }
    })
  }

  const getRowMismatchCount = (row) => {
    const colsInfo = row.compare?.columns || {}
    return compareColumns.reduce((acc, col) => {
      const info = colsInfo[col]
      if (!info) return acc
      return acc + (info.all_equal === false ? 1 : 0)
    }, 0)
  }

  const renderMediaCell = (row) => {
    const media = row.media
    if (!media || !media.batch_id || !media.filename) {
      return <span className="text-[11px] text-gray-400">Không có media</span>
    }

    const src = `/api/media/${encodeURIComponent(media.batch_id)}/${encodeURIComponent(media.filename)}`

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

    return <span className="text-[11px] text-gray-400">Không hỗ trợ media này</span>
  }

  const handleExport = async () => {
    if (!compareJob?.compare_id) return

    try {
      setExporting(true)

      const rowsPayload = Object.entries(overrides).map(([idValue, finalVals]) => ({
        id_value: idValue,
        final_values: finalVals
      }))

      if (rowsPayload.length === 0) {
        const resp = await axios.get(`/api/compare/export/${compareJob.compare_id}`, {
          responseType: 'blob'
        })

        const url = window.URL.createObjectURL(new Blob([resp.data]))
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', `compare_result_${compareJob.compare_id}.xlsx`)
        document.body.appendChild(link)
        link.click()
        link.remove()
        return
      }

      const resp = await axios.post(
        `/api/compare/export-with-overrides/${compareJob.compare_id}`,
        { rows: rowsPayload },
        { responseType: 'blob' }
      )

      const url = window.URL.createObjectURL(new Blob([resp.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `compare_result_${compareJob.compare_id}.xlsx`)
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (e) {
      console.error('[Compare] Lỗi export:', e)
      alert('Lỗi khi export kết quả Compare')
    } finally {
      setExporting(false)
    }
  }

  const allRows = Array.isArray(compareResult?.results) ? compareResult.results : []

  const getColumnCompareInfo = (row, colName) => {
    if (!row || !row.compare || !row.compare.columns || !colName) return null
    const cols = row.compare.columns
    if (Object.prototype.hasOwnProperty.call(cols, colName)) return cols[colName]
    const target = String(colName).trim().toLowerCase()
    for (const key of Object.keys(cols)) {
      try {
        if (String(key).trim().toLowerCase() === target) {
          return cols[key]
        }
      } catch (e) {
        // ignore
      }
    }
    return null
  }

  const filteredRows = allRows.filter((row) => {
    if (rowStatusFilter === 'equal' && row.compare?.equal !== true) return false
    if (rowStatusFilter === 'diff' && row.compare?.equal !== false) return false

    if (mediaFilter === 'has') {
      if (!row.media || !row.media.batch_id || !row.media.filename) return false
    } else if (mediaFilter === 'none') {
      if (row.media && row.media.batch_id && row.media.filename) return false
    }

    const key = (columnFilterKey || '').trim()
    const value = (columnFilterValue || '').trim().toLowerCase()
    if (key && value) {
      const colInfo = getColumnCompareInfo(row, key)
      const values = colInfo && Array.isArray(colInfo.values) ? colInfo.values : []
      const hasMatch = values.some((v) => {
        if (v === null || v === undefined) return false
        try {
          return String(v).toLowerCase().includes(value)
        } catch (e) {
          return false
        }
      })
      if (!hasMatch) return false
    }

    return true
  })

  const sortedRows = [...filteredRows]
  const focusColumn = (columnFilterKey || '').trim()

  sortedRows.sort((a, b) => {
    if (focusColumn) {
      const aInfo = getColumnCompareInfo(a, focusColumn)
      const bInfo = getColumnCompareInfo(b, focusColumn)
      const aDiff = aInfo && aInfo.all_equal === false
      const bDiff = bInfo && bInfo.all_equal === false

      if (aDiff !== bDiff) {
        // Dòng có khác nhau ở cột được chọn sẽ được đưa lên trước
        return aDiff ? -1 : 1
      }
    }

    if (rowSortOption !== 'none') {
      const da = getRowMismatchCount(a)
      const db = getRowMismatchCount(b)
      if (rowSortOption === 'fewDiffFirst') return da - db
      if (rowSortOption === 'manyDiffFirst') return db - da
    }

    return 0
  })

  const totalRows = sortedRows.length
  const totalPages = totalRows > 0 ? Math.ceil(totalRows / PAGE_SIZE) : 1
  const startIndex = totalRows === 0 ? 0 : (currentPage - 1) * PAGE_SIZE
  const endIndex = totalRows === 0 ? 0 : Math.min(startIndex + PAGE_SIZE, totalRows)
  const paginatedRows = totalRows > 0 ? sortedRows.slice(startIndex, endIndex) : []

  const summary = compareResult?.summary || {}
  const overall = summary.overall || {}
  const columnsSummary = summary.columns || {}

  const columnsSummaryEntries = Object.entries(columnsSummary)
  const sortedColumnsSummary = [...columnsSummaryEntries]
  if (colSummarySort !== 'none') {
    sortedColumnsSummary.sort(([, a], [, b]) => {
      const at = a.total_rows || 0
      const bt = b.total_rows || 0
      const aRate = at > 0 ? (a.diff_count || 0) / at : 0
      const bRate = bt > 0 ? (b.diff_count || 0) / bt : 0
      if (colSummarySort === 'diffDesc') return bRate - aRate
      if (colSummarySort === 'diffAsc') return aRate - bRate
      return 0
    })
  }

  const overallTotal = overall.total_rows || 0
  const overallSameRate = overallTotal > 0 ? ((overall.rows_all_same || 0) / overallTotal * 100).toFixed(1) : '0.0'
  const overallDiffRate = overallTotal > 0 ? ((overall.rows_any_diff || 0) / overallTotal * 100).toFixed(1) : '0.0'

  const datasetsInfo = compareResult?.datasets_info || []

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Compare data</h2>
        <p className="text-gray-600">
          So sánh/kiểm tra từ 1 đến 5 file data theo cùng schema, dùng chung cột ID để ghép dòng.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6 space-y-6">
        <div className="border-b border-gray-200 pb-4 mb-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center">
            <Upload className="w-5 h-5 mr-2" /> 1. Upload & chọn các file data (1–5 file)
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Mỗi file là một phiên bản data khác nhau (ví dụ: kết quả từ nhiều vòng labeling khác nhau).
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            {datasets.map((ds, idx) => (
              <div
                key={ds.id}
                className="flex-1 min-w-[220px] border border-gray-200 rounded-lg p-4 bg-gray-50 flex flex-col space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <FileText className="w-4 h-4 text-primary-600" />
                    <span className="text-sm font-semibold text-gray-900">File {idx + 1}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveDataset(ds.id)}
                    className="text-xs text-red-600 hover:text-red-800"
                  >
                    Xóa
                  </button>
                </div>

                <input
                  type="text"
                  value={ds.label || ''}
                  onChange={(e) => handleLabelChange(ds.id, e.target.value)}
                  className="mt-1 w-full px-2 py-1 border border-gray-300 rounded text-xs"
                  placeholder={`Tên hiển thị (ví dụ: Vòng 1, Vòng 2...)`}
                />

                <div className="text-xs text-gray-700 mt-1">
                  <div className="font-mono truncate" title={ds.file?.name}>
                    {ds.file?.name || 'Đang tải...'}
                  </div>
                  {ds.info && (
                    <div className="mt-1 text-gray-500">
                      {ds.info.rows} dòng, {ds.info.columns?.length || 0} cột
                    </div>
                  )}
                </div>

                {ds.uploading && (
                  <div className="flex items-center text-xs text-gray-500 mt-1">
                    <Loader className="w-3 h-3 mr-1 animate-spin" /> Đang upload & parse...
                  </div>
                )}

                {ds.error && (
                  <div className="mt-1 flex items-start space-x-1 text-xs text-red-600">
                    <AlertTriangle className="w-3 h-3 mt-0.5" />
                    <span>{ds.error}</span>
                  </div>
                )}
              </div>
            ))}

            {datasets.length < maxFiles && (
              <label className="flex-1 min-w-[220px] border-2 border-dashed border-gray-300 rounded-lg p-4 cursor-pointer hover:border-primary-500 hover:bg-primary-50 flex flex-col items-center justify-center text-center text-sm text-gray-600">
                <input
                  key={fileInputKey}
                  type="file"
                  className="hidden"
                  multiple
                  onChange={handleAddDataset}
                  accept=".xlsx,.xls,.csv"
                />
                <Upload className="w-6 h-6 text-gray-400 mb-2" />
                <span>Thêm file data mới</span>
                <span className="text-xs text-gray-400 mt-1">Hỗ trợ .xlsx, .xls, .csv</span>
              </label>
            )}
          </div>

          {error && (
            <div className="mt-2 flex items-start space-x-2 text-sm text-red-600">
              <AlertTriangle className="w-4 h-4 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 pt-4 mt-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center">
            <Table className="w-5 h-5 mr-2" /> 2. Cấu hình cột so sánh
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Các file cần có cùng danh sách cột. Hệ thống dùng cột ID để ghép dòng giữa các file.
          </p>

          <div className="mt-3 mb-2 flex flex-col md:flex-row md:items-center md:space-x-3 space-y-2 md:space-y-0">
            <label className="text-xs font-medium text-gray-700 md:w-1/3">
              Dùng lại cấu hình Compare từ project đã lưu:
            </label>
            <div className="flex-1 flex items-center space-x-2">
              <select
                defaultValue=""
                disabled={loadingCompareTemplates || compareTemplates.length === 0}
                onChange={(e) => {
                  const val = e.target.value
                  if (val) applyCompareTemplate(val)
                }}
                className="w-full md:w-auto flex-1 px-3 py-2 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-400"
              >
                <option value="">
                  {loadingCompareTemplates
                    ? 'Đang tải danh sách project Compare...'
                    : compareTemplates.length === 0
                    ? 'Chưa có project Compare nào'
                    : '-- Chọn project Compare --'}
                </option>
                {compareTemplates.map((p) => (
                  <option key={p.project_id} value={p.project_id}>
                    {p.name || p.project_id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {firstColumns.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">
              Hãy upload ít nhất 1 file data để lấy danh sách cột.
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cột ID (để ghép dòng)</label>
                <select
                  value={idColumn}
                  onChange={(e) => setIdColumn(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">-- Chọn cột ID --</option>
                  {firstColumns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">Ví dụ: image_id, uuid, id...</p>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Các cột cần so sánh</label>
                <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-md p-2 bg-white text-sm">
                  {firstColumns
                    .filter((col) => col !== idColumn)
                    .map((col) => (
                      <label key={col} className="flex items-center space-x-2 py-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={compareColumns.includes(col)}
                          onChange={() => toggleCompareColumn(col)}
                          className="h-4 w-4 text-primary-600 border-gray-300 rounded"
                        />
                        <span className="font-mono text-xs text-gray-800">{col}</span>
                      </label>
                    ))}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Chỉ các cột được chọn mới được so sánh và xuất ra.
                </p>
              </div>

              {datasets.length > 0 && (
                <div className="md:col-span-3 flex flex-wrap items-start gap-8 mt-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">File chuẩn (reference)</label>
                    <select
                      value={referenceIndex}
                      onChange={(e) => setReferenceIndex(Number(e.target.value) || 0)}
                      className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                    >
                      {datasets.map((ds, idx) => (
                        <option key={ds.id} value={idx}>
                          {ds.label || `File ${idx + 1}`}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      Mặc định giá trị chốt sẽ lấy từ file chuẩn, bạn có thể chỉnh sửa sau.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Cột media (tùy chọn)</label>
                    <select
                      value={mediaColumn}
                      onChange={(e) => setMediaColumn(e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[220px]"
                    >
                      <option value="">-- Không dùng cột media --</option>
                      {firstColumns.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      Nếu data có cột chứa tên file hình/audio/video (ví dụ: image_file, media_name...), chọn ở đây
                      để hệ thống map sang batch media đã upload và hiển thị trên từng dòng.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 pt-4 mt-4 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {compareStatus && (
              <>
                <span className="font-medium">Trạng thái Compare: </span>
                <span className="uppercase">{compareStatus.status}</span>
                {compareStatus.progress && (
                  <span className="ml-2">
                    ({compareStatus.progress.processed}/{compareStatus.progress.total} dòng)
                  </span>
                )}
              </>
            )}
          </div>

          <button
            type="button"
            onClick={handleStartCompare}
            disabled={!canStartCompare || starting}
            className={`inline-flex items-center px-6 py-2 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 ${
              canStartCompare && !starting
                ? 'bg-primary-600 text-white hover:bg-primary-700 shadow'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            {starting ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" /> Đang bắt đầu Compare...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 mr-2" /> Bắt đầu Compare
              </>
            )}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Tạo Project Compare (tùy chọn)</h3>
        <p className="text-xs text-gray-600">
          Nếu bạn muốn lưu lại cấu hình Compare (cột ID, cột so sánh, media, danh sách file) để dùng lại sau này, hãy tạo
          Project Compare. Nếu không cần, bạn có thể bỏ qua bước này và chạy Compare bình thường.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
          <div className="md:col-span-2 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Tên Project</label>
              <input
                type="text"
                value={projectData.name || ''}
                onChange={(e) => setProjectData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Nhập tên project Compare..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Mô tả (tùy chọn)</label>
                <textarea
                  rows={2}
                  value={projectData.description || ''}
                  onChange={(e) => setProjectData((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Mô tả mục đích, nội dung Compare..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Người tạo</label>
                <input
                  type="text"
                  value={projectData.created_by || ''}
                  onChange={(e) => setProjectData((prev) => ({ ...prev, created_by: e.target.value }))}
                  placeholder="Tên người tạo project..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2 text-xs">
            <p className="text-gray-500">
              Project Compare sẽ lưu:
            </p>
            <ul className="list-disc list-inside text-gray-600">
              <li>Các file data đã chọn + label</li>
              <li>Cột ID, cột so sánh, file chuẩn</li>
              <li>Cột media (nếu có), guideline/media</li>
            </ul>
            <button
              type="button"
              onClick={handleSaveProject}
              disabled={savingProject || !projectData.name?.trim() || datasets.length === 0}
              className={`mt-2 inline-flex items-center px-4 py-2 rounded-md text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 ${
                savingProject || !projectData.name?.trim() || datasets.length === 0
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-primary-600 text-white hover:bg-primary-700 shadow'
              }`}
            >
              {savingProject ? 'Đang lưu project...' : projectData.saved ? 'Đã lưu project' : 'Lưu Project Compare'}
            </button>

            {projectData.project_id && (
              <p className="text-[11px] text-green-600 mt-1">ID: {projectData.project_id}</p>
            )}

            {projectError && (
              <p className="text-[11px] text-red-600 mt-1">{projectError}</p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Guideline & Media (tùy chọn)</h3>
        <p className="text-xs text-gray-600">
          Bạn có thể upload guideline và media để tiện mở xem song song khi đối chiếu kết quả Compare. Không bắt buộc.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <p className="text-xs text-gray-600 mb-2">
              Guideline (PDF/Excel/Word/TXT) dùng để bạn tự tham chiếu khi so sánh kết quả.
            </p>
            {!guideline ? (
              <div className="flex items-center justify-between">
                <label className="inline-flex items-center px-3 py-2 rounded-md border border-dashed border-gray-300 text-xs text-gray-700 cursor-pointer hover:border-primary-500 hover:bg-primary-50">
                  <Upload className="w-3 h-3 mr-2" />
                  <span>{uploadingGuideline ? 'Đang upload guideline...' : 'Chọn file guideline'}</span>
                  <input
                    type="file"
                    className="hidden"
                    onChange={handleGuidelineChange}
                    accept=".pdf,.xlsx,.xls,.doc,.docx,.txt"
                    disabled={uploadingGuideline}
                  />
                </label>
              </div>
            ) : (
              <div className="flex items-center justify-between text-xs">
                <div>
                  <div
                    className="font-medium text-gray-800 truncate"
                    title={guideline.file?.name || guideline.info?.file_name}
                  >
                    {guideline.file?.name || guideline.info?.file_name}
                  </div>
                  <div className="text-gray-500 mt-1">ID: {guideline.info?.file_id}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setGuideline(null)}
                  className="text-red-600 hover:text-red-800 ml-2"
                >
                  Xóa
                </button>
              </div>
            )}
          </div>

          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <p className="text-xs text-gray-600 mb-2">
              Media (ảnh/audio/video) dùng để bạn mở xem trực tiếp trên từng dòng kết quả Compare.
            </p>
            {!mediaInfo ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="inline-flex items-center px-3 py-2 rounded-md border border-dashed border-gray-300 text-xs text-gray-700 cursor-pointer hover:border-primary-500 hover:bg-primary-50">
                    <Upload className="w-3 h-3 mr-2" />
                    <span>{uploadingMedia ? 'Đang upload media...' : 'Chọn nhiều file media'}</span>
                    <input
                      type="file"
                      className="hidden"
                      multiple
                      accept="image/*,audio/*,video/*"
                      onChange={handleMediaChange}
                      disabled={uploadingMedia}
                    />
                  </label>
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-xs text-gray-500">Hoặc chọn nguyên folder media</div>
                  <div>
                    <input
                      type="file"
                      ref={mediaFolderInputRef}
                      webkitdirectory=""
                      directory=""
                      multiple
                      accept="image/*,audio/*,video/*"
                      onChange={handleMediaChange}
                      className="hidden"
                      disabled={uploadingMedia}
                    />
                    <button
                      type="button"
                      onClick={() => mediaFolderInputRef.current?.click()}
                      disabled={uploadingMedia}
                      className="inline-flex items-center px-3 py-2 rounded-md border border-primary-300 text-xs font-medium text-primary-700 bg-white hover:bg-primary-50 disabled:opacity-50"
                    >
                      Chọn folder media
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between text-xs">
                <div>
                  <div className="font-medium text-gray-800">
                    {mediaInfo.info?.files?.length || mediaInfo.files?.length || 0} files
                  </div>
                  <div className="text-gray-500 mt-1">Batch ID: {mediaInfo.info?.batch_id}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setMediaInfo(null)}
                  className="text-red-600 hover:text-red-800 ml-2"
                >
                  Xóa
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {(loadingResult || compareResult) && (
        <div className="bg-white rounded-lg shadow-lg p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">3. Kết quả Compare</h3>
              <p className="text-sm text-gray-600">
                Xem tổng quan tỉ lệ giống/khác và chỉnh sửa giá trị chốt cuối cùng nếu cần.
              </p>
            </div>

            <button
              type="button"
              onClick={handleExport}
              disabled={!compareResult || exporting}
              className={`inline-flex items-center px-5 py-2 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 ${
                compareResult && !exporting
                  ? 'bg-primary-600 text-white hover:bg-primary-700 shadow'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              {exporting ? (
                <>
                  <Loader className="w-4 h-4 mr-2 animate-spin" /> Đang export...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" /> Export Excel
                </>
              )}
            </button>
          </div>

          {loadingResult && !compareResult && (
            <div className="flex flex-col items-center justify-center py-8 text-gray-600">
              <Loader className="w-8 h-8 mb-3 animate-spin text-primary-600" />
              <p>Đang tải kết quả Compare...</p>
            </div>
          )}

          {compareResult && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-1">Tổng số dòng</p>
                  <p className="text-2xl font-bold text-gray-900">{overall.total_rows || 0}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-1">Dòng tất cả giống nhau</p>
                  <p className="text-2xl font-bold text-green-600">{overall.rows_all_same || 0}</p>
                  <p className="text-xs text-gray-500 mt-1">{overallSameRate}% tổng số dòng</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-1">Dòng có khác nhau</p>
                  <p className="text-2xl font-bold text-red-600">{overall.rows_any_diff || 0}</p>
                  <p className="text-xs text-gray-500 mt-1">{overallDiffRate}% tổng số dòng</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-1">Số file</p>
                  <p className="text-2xl font-bold text-primary-600">{datasetsInfo.length}</p>
                </div>
              </div>

              <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-gray-800">Tỉ lệ giống/khác theo từng cột</p>
                  <div className="flex items-center space-x-1 text-xs text-gray-600">
                    <span>Sắp xếp:</span>
                    <select
                      value={colSummarySort}
                      onChange={(e) => setColSummarySort(e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded bg-white"
                    >
                      <option value="none">Mặc định</option>
                      <option value="diffDesc">Tỉ lệ khác ↓</option>
                      <option value="diffAsc">Tỉ lệ khác ↑</option>
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Cột</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Số dòng</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Dòng giống nhau</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Dòng khác nhau</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Tỉ lệ giống (%)</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Tỉ lệ khác (%)</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Dòng có ≥2 giá trị giống</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Tỉ lệ ≥2 giống (%)</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Dòng tất cả khác</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Tỉ lệ tất cả khác (%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedColumnsSummary.map(([col, info]) => {
                        const total = info.total_rows || 0
                        const same = info.same_count || 0
                        const diff = info.diff_count || 0
                        const partial = info.partial_equal_rows || 0
                        const allDiff = info.all_diff_rows || 0
                        const sameRate = total > 0 ? (same / total) * 100 : 0
                        const diffRateNum = total > 0 ? (diff / total) * 100 : 0
                        const partialRateNum = total > 0 ? (partial / total) * 100 : 0
                        const allDiffRateNum = total > 0 ? (allDiff / total) * 100 : 0

                        const rate = sameRate.toFixed(1)
                        const diffRate = diffRateNum.toFixed(1)
                        const partialRate = partialRateNum.toFixed(1)
                        const allDiffRate = allDiffRateNum.toFixed(1)

                        let diffHeatClass = ''
                        if (diffRateNum >= 60) diffHeatClass = 'bg-red-500 text-white'
                        else if (diffRateNum >= 40) diffHeatClass = 'bg-red-400 text-white'
                        else if (diffRateNum >= 20) diffHeatClass = 'bg-red-200 text-red-800'
                        else if (diffRateNum > 0) diffHeatClass = 'bg-red-50 text-red-700'

                        return (
                          <tr key={col} className="border-t border-gray-200">
                            <td className="px-3 py-2 font-mono text-gray-800 whitespace-nowrap">{col}</td>
                            <td className="px-3 py-2">{total}</td>
                            <td className="px-3 py-2">{same}</td>
                            <td className="px-3 py-2">{diff}</td>
                            <td className="px-3 py-2">{rate}%</td>
                            <td className={`px-3 py-2 font-semibold ${diffHeatClass}`}>{diffRate}%</td>
                            <td className="px-3 py-2">{partial}</td>
                            <td className="px-3 py-2">{partialRate}%</td>
                            <td className="px-3 py-2">{allDiff}</td>
                            <td className="px-3 py-2">{allDiffRate}%</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {totalRows > 0 && (
                  <div className="px-4 py-2 border-t border-gray-200 flex items-center justify-between text-xs text-gray-600">
                    <span>
                      Hiển thị {startIndex + 1}-{endIndex}/{totalRows} dòng
                    </span>
                    <div className="flex items-center space-x-1">
                      <button
                        type="button"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className={`px-2 py-1 rounded border ${
                          currentPage === 1
                            ? 'text-gray-400 border-gray-200 cursor-not-allowed'
                            : 'text-gray-700 border-gray-300 hover:bg-gray-100'
                        }`}
                      >
                        Trước
                      </button>
                      <span>
                        Trang {currentPage}/{totalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className={`px-2 py-1 rounded border ${
                          currentPage === totalPages
                            ? 'text-gray-400 border-gray-200 cursor-not-allowed'
                            : 'text-gray-700 border-gray-300 hover:bg-gray-100'
                        }`}
                      >
                        Sau
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-6 border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 lg:gap-4">
                  <h4 className="text-sm font-semibold text-gray-900">Chi tiết theo từng dòng</h4>
                  {totalRows > 0 && (
                    <div className="text-[11px] text-gray-600 flex flex-wrap items-center gap-3">
                      <div className="flex items-center space-x-1">
                        <span>Lọc trạng thái:</span>
                        <select
                          value={rowStatusFilter}
                          onChange={(e) => {
                            setRowStatusFilter(e.target.value)
                            setCurrentPage(1)
                          }}
                          className="px-2 py-1 border border-gray-300 rounded-md bg-white"
                        >
                          <option value="all">Tất cả</option>
                          <option value="equal">Chỉ dòng tất cả giống nhau</option>
                          <option value="diff">Chỉ dòng có khác nhau</option>
                        </select>
                      </div>

                      <div className="flex items-center space-x-1">
                        <span>Media:</span>
                        <select
                          value={mediaFilter}
                          onChange={(e) => {
                            setMediaFilter(e.target.value)
                            setCurrentPage(1)
                          }}
                          className="px-2 py-1 border border-gray-300 rounded-md bg-white"
                        >
                          <option value="all">Tất cả</option>
                          <option value="has">Chỉ dòng có media</option>
                          <option value="none">Chỉ dòng không có media</option>
                        </select>
                      </div>

                      <div className="flex items-center space-x-1">
                        <span>Sắp xếp theo cột:</span>
                        <select
                          value={columnFilterKey}
                          onChange={(e) => {
                            setColumnFilterKey(e.target.value)
                            setCurrentPage(1)
                          }}
                          className="px-2 py-1 border border-gray-300 rounded-md bg-white max-w-[160px]"
                        >
                          <option value="">-- Cột so sánh --</option>
                          {compareColumns.map((col) => (
                            <option key={col} value={col}>
                              {col}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={columnFilterValue}
                          onChange={(e) => {
                            setColumnFilterValue(e.target.value)
                            setCurrentPage(1)
                          }}
                          placeholder={columnFilterKey ? `Giá trị chứa...` : 'Chọn cột trước'}
                          disabled={!columnFilterKey}
                          className="px-2 py-1 border border-gray-300 rounded-md bg-white text-[11px] min-w-[140px] disabled:bg-gray-100 disabled:text-gray-400"
                        />
                      </div>

                      <div className="flex items-center space-x-1">
                        <span>Sắp xếp:</span>
                        <select
                          value={rowSortOption}
                          onChange={(e) => {
                            setRowSortOption(e.target.value)
                            setCurrentPage(1)
                          }}
                          className="px-2 py-1 border border-gray-300 rounded-md bg-white"
                        >
                          <option value="none">Không sắp xếp</option>
                          <option value="fewDiffFirst">Ít cột khác trước</option>
                          <option value="manyDiffFirst">Nhiều cột khác trước</option>
                        </select>
                      </div>

                      <div className="flex items-center space-x-2">
                        <span>
                          Hiển thị {startIndex + 1}-{endIndex}/{totalRows} dòng
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs table-fixed">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600 w-32">ID</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600 w-28">
                          Trạng thái
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600 w-80">Media</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600 w-[260px]">
                          Giá trị theo từng file
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600 w-[420px]">
                          Phân tích khác nhau
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {paginatedRows.map((row, idx) => {
                        const isEqual = row.compare?.equal
                        const colsInfo = row.compare?.columns || {}

                        const rawDiffDescriptions = Object.entries(colsInfo)
                          .filter(([, info]) => !info.all_equal)
                          .map(([col, info]) => {
                            const differentFromRef = info.different_from_ref || []
                            const diffIndexes = differentFromRef
                              .map((flag, i) => (flag ? i + 1 : null))
                              .filter((v) => v !== null)

                            return {
                              col,
                              info,
                              diffIndexes,
                            }
                          })

                        const focusColName = (columnFilterKey || '').trim().toLowerCase()
                        const diffDescriptions = [...rawDiffDescriptions].sort((a, b) => {
                          const aFocus =
                            focusColName && String(a.col || '').trim().toLowerCase() === focusColName
                          const bFocus =
                            focusColName && String(b.col || '').trim().toLowerCase() === focusColName
                          if (aFocus !== bFocus) return aFocus ? -1 : 1
                          return String(a.col || '').localeCompare(String(b.col || ''))
                        })

                        const idValue = row.id_value
                        const rowOverrides = overrides[idValue] || {}

                        const colIndexMap = {}
                        compareColumns.forEach((c, i) => {
                          colIndexMap[c] = i
                        })
                        const focusCol = (columnFilterKey || '').trim().toLowerCase()
                        const orderedCompareColumns = [...compareColumns].sort((a, b) => {
                          const aName = String(a || '')
                          const bName = String(b || '')
                          const aFocus = focusCol && aName.trim().toLowerCase() === focusCol
                          const bFocus = focusCol && bName.trim().toLowerCase() === focusCol
                          if (aFocus !== bFocus) {
                            // Ưu tiên cột đang được chọn ở "Sắp xếp theo cột" hiển thị trước
                            return aFocus ? -1 : 1
                          }

                          const aInfo = colsInfo[a]
                          const bInfo = colsInfo[b]
                          const aDiff = aInfo && aInfo.all_equal === false
                          const bDiff = bInfo && bInfo.all_equal === false
                          if (aDiff === bDiff) {
                            return (colIndexMap[a] || 0) - (colIndexMap[b] || 0)
                          }
                          return aDiff ? -1 : 1
                        })

                        return (
                          <React.Fragment key={row.id_value ?? row.row_index ?? idx}>
                            <tr className="align-top">
                              <td className="px-3 py-3 font-mono text-gray-800 text-[11px] max-w-[120px] truncate">
                                {row.id_value ?? '(không ID)'}
                              </td>
                              <td className="px-3 py-3">
                                {isEqual ? (
                                  <span className="inline-flex items-center px-2 py-1 rounded-full bg-green-100 text-green-800 text-[11px] font-medium">
                                    Tất cả giống nhau
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-1 rounded-full bg-red-100 text-red-800 text-[11px] font-medium">
                                    Có khác nhau
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-3 w-80 align-top">{renderMediaCell(row)}</td>
                              <td className="px-3 py-3 text-gray-800 align-top w-[320px]">
                                <div className="space-y-2 overflow-hidden text-xs leading-relaxed">
                                  {datasetsInfo.map((ds, dIdx) => {
                                    const label = ds.label || `File ${dIdx + 1}`
                                    const perRow = row.rows?.[dIdx]?.row_data || {}
                                    const pairList = compareColumns.map((col) => `${col}: ${perRow?.[col] ?? 'null'}`)
                                    return (
                                      <div key={ds.index}>
                                        <div className="text-sm font-semibold text-gray-900">{label}</div>
                                        <div
                                          className="text-xs text-gray-700 whitespace-normal break-words"
                                          title={pairList.join(' | ')}
                                        >
                                          {pairList.join(' | ')}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </td>
                              <td className="px-3 py-3 text-gray-800 align-top w-[480px]">
                                {diffDescriptions.length === 0 ? (
                                  <span className="text-gray-400 text-xs">Không có khác biệt ở các cột đã chọn.</span>
                                ) : (
                                  <ul className="space-y-2 text-xs leading-relaxed list-none">
                                    {diffDescriptions.map((desc, i) => {
                                      const values = desc.info?.values || []

                                      return (
                                        <li key={i} className="whitespace-normal break-words">
                                          <div className="font-semibold text-gray-900">
                                            {`Cột ${desc.col}:`}
                                          </div>
                                          <div className="mt-1 space-y-0.5">
                                            {datasetsInfo.map((ds, dIdx) => {
                                              const label = ds.label || `File ${dIdx + 1}`
                                              const raw = values[dIdx]
                                              const display =
                                                raw === null || raw === undefined ? 'null' : String(raw)
                                              return (
                                                <div key={dIdx} className="text-gray-700">
                                                  - {label}: {display}
                                                </div>
                                              )
                                            })}
                                          </div>
                                          <div className="mt-1 text-gray-700">
                                            {`-> Khác so với file chuẩn ở: ${
                                              desc.diffIndexes.length > 0
                                                ? desc.diffIndexes.join(', ')
                                                : 'không.'
                                            }`}
                                          </div>
                                        </li>
                                      )
                                    })}
                                  </ul>
                                )}
                              </td>
                            </tr>
                            <tr className="bg-gray-50">
                              <td colSpan={5} className="px-3 pb-3 pt-1 text-gray-700">
                                <div className="border-t border-gray-200 pt-2">
                                  <div className="text-[11px] font-semibold text-gray-800 mb-1">
                                    Giá trị chốt cuối cùng
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                    {orderedCompareColumns.map((col) => {
                                      const colInfo = row.compare?.columns?.[col]
                                      const values = (colInfo?.values || []).map((v) =>
                                        v === null || v === undefined ? 'null' : String(v)
                                      )
                                      const uniqueValues = Array.from(new Set(values))

                                      const baseRaw = row.final_values?.[col]
                                      const baseDisplay =
                                        baseRaw === null || baseRaw === undefined
                                          ? '(theo file chuẩn / trống)'
                                          : String(baseRaw)

                                      const hasOverride = Object.prototype.hasOwnProperty.call(rowOverrides, col)
                                      const currentOverride = hasOverride ? rowOverrides[col] : undefined

                                      const suggestions = Array.from(
                                        new Set(
                                          [
                                            ...uniqueValues.filter((v) => v && v !== 'null'),
                                            baseDisplay && baseDisplay !== 'null'
                                              ? baseDisplay
                                              : null,
                                          ].filter(Boolean)
                                        )
                                      )

                                      const inputValue =
                                        currentOverride === null || currentOverride === undefined
                                          ? ''
                                          : String(currentOverride)

                                      const hasDiff = colInfo && colInfo.all_equal === false
                                      const datalistId = `final-suggest-${row.id_value ?? row.row_index ?? idx}-${col}`

                                      const effective = getEffectiveFinalValue(row, col)
                                      const effectiveStr =
                                        effective === null || effective === undefined ? '' : String(effective)

                                      return (
                                        <div
                                          key={col}
                                          className={`border rounded px-2 py-1 bg-white flex flex-wrap items-center gap-2 text-xs ${
                                            hasDiff ? 'border-red-400' : 'border-gray-200'
                                          }`}
                                        >
                                          <span className="font-mono text-gray-900 font-semibold">{col}</span>

                                          {datasetsInfo.map((ds, dIdx) => {
                                            const raw = colInfo?.values?.[dIdx]
                                            const vStr =
                                              raw === null || raw === undefined ? 'null' : String(raw)
                                            const label = ds.label || `File ${dIdx + 1}`
                                            const isSelected = vStr === (effectiveStr || 'null')

                                            const handleClick = () => {
                                              const baseStr =
                                                baseRaw === null || baseRaw === undefined
                                                  ? 'null'
                                                  : String(baseRaw)
                                              if (vStr === baseStr) {
                                                // giống giá trị chuẩn -> xoá override
                                                handleFinalChange(row, col, null)
                                              } else {
                                                handleFinalChange(row, col, vStr === 'null' ? '' : vStr)
                                              }
                                            }

                                            return (
                                              <button
                                                key={`${col}_ds_${dIdx}`}
                                                type="button"
                                                onClick={handleClick}
                                                className={`px-2 py-0.5 rounded border whitespace-nowrap text-[11px] font-medium ${
                                                  isSelected
                                                    ? 'bg-primary-50 border-primary-500 text-primary-700'
                                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                                                }`}
                                              >
                                                {label}:{' '}
                                                <span className="font-semibold">{vStr}</span>
                                              </button>
                                            )
                                          })}

                                          <span className="ml-auto text-[11px] text-gray-600">
                                            Chuẩn:{' '}
                                            <span className="font-semibold text-blue-700">{baseDisplay}</span>
                                          </span>

                                          <div className="flex items-center gap-1 w-full mt-1">
                                            <input
                                              type="text"
                                              list={datalistId}
                                              className="flex-1 px-2 py-1 border border-gray-300 rounded text-[11px]"
                                              placeholder={
                                                baseRaw === null || baseRaw === undefined
                                                  ? 'Giá trị khác (tuỳ chọn)'
                                                  : `Giá trị khác (trống = dùng "${baseDisplay}")`
                                              }
                                              value={inputValue}
                                              onChange={(e) =>
                                                handleFinalChange(
                                                  row,
                                                  col,
                                                  e.target.value.trim() === '' ? null : e.target.value
                                                )
                                              }
                                            />
                                            {hasOverride && (
                                              <button
                                                type="button"
                                                onClick={() => handleFinalChange(row, col, null)}
                                                className="px-2 py-1 text-[10px] rounded border border-gray-300 text-gray-600 hover:bg-gray-100 whitespace-nowrap"
                                              >
                                                Xoá ghi đè
                                              </button>
                                            )}
                                            <datalist id={datalistId}>
                                              {suggestions.map((val) => (
                                                <option key={`${col}_${val}`} value={val} />
                                              ))}
                                            </datalist>
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {totalRows > 0 && (
                  <div className="px-4 py-2 border-t border-gray-200 flex items-center justify-between text-xs text-gray-600">
                    <span>
                      Hiển thị {startIndex + 1}-{endIndex}/{totalRows} dòng
                    </span>
                    <div className="flex items-center space-x-1">
                      <button
                        type="button"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className={`px-2 py-1 rounded border ${
                          currentPage === 1
                            ? 'text-gray-400 border-gray-200 cursor-not-allowed'
                            : 'text-gray-700 border-gray-300 hover:bg-gray-100'
                        }`}
                      >
                        Trước
                      </button>
                      <span>
                        Trang {currentPage}/{totalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className={`px-2 py-1 rounded border ${
                          currentPage === totalPages
                            ? 'text-gray-400 border-gray-200 cursor-not-allowed'
                            : 'text-gray-700 border-gray-300 hover:bg-gray-100'
                        }`}
                      >
                        Sau
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

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
              className="max-h-[85vh] max-w-[90vw] min-h-[320px] min-w-[320px] rounded shadow-2xl object-contain bg-black"
            />
            <button
              type="button"
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

export default CompareData
