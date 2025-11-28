import React, { useState, useEffect } from 'react'
import axios from 'axios'

function AiCardPage({ currentUser }) {
  const [projects, setProjects] = useState([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createFile, setCreateFile] = useState(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createColumns, setCreateColumns] = useState([])
  const [createImageColumn, setCreateImageColumn] = useState('')
  const [createAttrColumns, setCreateAttrColumns] = useState(['Occlusion', 'Expression', 'Illumination'])
  const [createDataId, setCreateDataId] = useState(null)

  const [selectedProjectId, setSelectedProjectId] = useState(null)
  const [cards, setCards] = useState([])
  const [cardsTotal, setCardsTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)
  const [loadingCards, setLoadingCards] = useState(false)
  const [cardsError, setCardsError] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedFilter, setSelectedFilter] = useState('all')
  const [updatingRowId, setUpdatingRowId] = useState(null)
  const [aspectMode, setAspectMode] = useState('square')
  const [attrFilterKey, setAttrFilterKey] = useState('')
  const [attrFilterValue, setAttrFilterValue] = useState('')
  const [primaryAttrFilterKey, setPrimaryAttrFilterKey] = useState('')
  const [primaryAttrFilterValue, setPrimaryAttrFilterValue] = useState('')
  const [previewCard, setPreviewCard] = useState(null)
  const [eventStatsFull, setEventStatsFull] = useState(null)
  const [loadingEventStats, setLoadingEventStats] = useState(false)
  const [eventStatsError, setEventStatsError] = useState('')
  const [attrValueOptions, setAttrValueOptions] = useState([])

  const userRole = (currentUser?.role || '').toLowerCase()
  const isOwner = userRole === 'owner'
  const userPermissions = currentUser?.permissions || []
  const canEdit = !!currentUser && (isOwner || userPermissions.includes('edit_ai_card'))

  useEffect(() => {
    const fetchProjects = async () => {
      setLoadingProjects(true)
      try {
        const resp = await axios.get('/api/aicard/projects')
        const list = resp.data?.projects || []
        setProjects(list)
        if (!selectedProjectId && list.length > 0) {
          setSelectedProjectId(list[0].id)
        }
      } catch (err) {
        console.error('[AI Card] Lỗi load projects', err)
      } finally {
        setLoadingProjects(false)
      }
    }

    fetchProjects()
  }, [selectedProjectId])

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1)
      setSearchTerm(searchInput)
    }, 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    const fetchCards = async () => {
      if (!selectedProjectId) return
      setLoadingCards(true)
      setCardsError('')
      try {
        const resp = await axios.get('/api/aicard/cards', {
          params: {
            project_id: selectedProjectId,
            page,
            page_size: pageSize,
            search: searchTerm || undefined,
            selected_filter: selectedFilter,
            primary_attr_key: primaryAttrFilterKey || undefined,
            primary_attr_value: primaryAttrFilterValue || undefined,
            attr_key: attrFilterKey || undefined,
            attr_value: attrFilterValue || undefined,
          },
        })
        const data = resp.data || {}
        setCards(data.cards || [])
        setCardsTotal(data.total || 0)
      } catch (err) {
        console.error('[AI Card] Lỗi load cards', err)
        const msg = err?.response?.data?.error || 'Không tải được danh sách card'
        setCardsError(msg)
      } finally {
        setLoadingCards(false)
      }
    }

    fetchCards()
  }, [
    selectedProjectId,
    page,
    pageSize,
    searchTerm,
    selectedFilter,
    primaryAttrFilterKey,
    primaryAttrFilterValue,
    attrFilterKey,
    attrFilterValue,
  ])

  useEffect(() => {
    if (!selectedProjectId) {
      setEventStatsFull(null)
      setEventStatsError('')
      return
    }

    const fetchEventStats = async () => {
      setLoadingEventStats(true)
      setEventStatsError('')
      try {
        const resp = await axios.get('/api/aicard/stats/event', {
          params: {
            project_id: selectedProjectId,
            event_column: 'Event',
            search: searchTerm || undefined,
            selected_filter: selectedFilter || 'all',
            primary_attr_key: primaryAttrFilterKey || undefined,
            primary_attr_value: primaryAttrFilterValue || undefined,
            attr_key: attrFilterKey || undefined,
            attr_value: attrFilterValue || undefined,
          },
        })
        const data = resp.data || {}
        setEventStatsFull({
          events: data.events || [],
          total_with_event: data.total_with_event || 0,
        })
      } catch (err) {
        console.error('[AI Card] Lỗi load thống kê Event toàn dataset', err)
        const msg = err?.response?.data?.error || 'Không tải được thống kê Event toàn dataset'
        setEventStatsError(msg)
        setEventStatsFull(null)
      } finally {
        setLoadingEventStats(false)
      }
    }

    fetchEventStats()
  }, [
    selectedProjectId,
    searchTerm,
    selectedFilter,
    primaryAttrFilterKey,
    primaryAttrFilterValue,
    attrFilterKey,
    attrFilterValue,
  ])

  useEffect(() => {
    if (!selectedProjectId || !attrFilterKey) {
      setAttrValueOptions([])
      return
    }

    const fetchAttrValues = async () => {
      try {
        const resp = await axios.get('/api/aicard/attributes/values', {
          params: {
            project_id: selectedProjectId,
            attr_column: attrFilterKey,
            search: searchTerm || undefined,
            selected_filter: selectedFilter || 'all',
            primary_attr_key: primaryAttrFilterKey || undefined,
            primary_attr_value: primaryAttrFilterValue || undefined,
          },
        })
        const data = resp.data || {}
        setAttrValueOptions(data.values || [])
      } catch (err) {
        console.error('[AI Card] Lỗi load gợi ý giá trị thuộc tính', err)
        setAttrValueOptions([])
      }
    }
    fetchAttrValues()
  }, [selectedProjectId, attrFilterKey, searchTerm, selectedFilter, primaryAttrFilterKey, primaryAttrFilterValue])

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0] || null
    setCreateFile(file)
    setCreateColumns([])
    setCreateDataId(null)
    setCreateError('')

    if (!file) return

    try {
      const formData = new FormData()
      formData.append('file', file)

      const uploadResp = await axios.post('/api/upload/data', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })

      const fileId = uploadResp.data?.file_id
      if (!fileId) {
        throw new Error('Không nhận được file_id từ backend')
      }

      setCreateDataId(fileId)

      const columns = uploadResp.data?.columns || []
      setCreateColumns(columns)

      if (columns && columns.length > 0) {
        const lowerMap = {}
        columns.forEach((col) => {
          lowerMap[String(col).toLowerCase()] = col
        })

        const imageCandidates = [
          'url_image',
          'urlimage',
          'url_name',
          'url',
          'image_url',
          'image',
          'files',
        ]

        let defaultImageCol = 'Url_image'
        for (const key of imageCandidates) {
          if (lowerMap[key]) {
            defaultImageCol = lowerMap[key]
            break
          }
        }
        setCreateImageColumn(defaultImageCol)

        const preferredAttrs = ['occlusion', 'expression', 'illumination']
        const defaultAttrs = []
        preferredAttrs.forEach((key) => {
          if (lowerMap[key]) {
            defaultAttrs.push(lowerMap[key])
          }
        })
        if (defaultAttrs.length > 0) {
          setCreateAttrColumns(defaultAttrs)
        } else {
          setCreateAttrColumns(['Occlusion', 'Expression', 'Illumination'])
        }
      } else {
        setCreateImageColumn('')
        setCreateAttrColumns(['Occlusion', 'Expression', 'Illumination'])
      }
    } catch (err) {
      console.error('[AI Card] Lỗi đọc cột từ file', err)
      const msg = err?.response?.data?.error || 'Đọc cột từ file thất bại, vui lòng thử lại'
      setCreateError(msg)
      setCreateDataId(null)
      setCreateColumns([])
    }
  }

  const handleCreateSubmit = async (e) => {
    e.preventDefault()
    if (!canEdit) return
    if (!createFile) {
      setCreateError('Vui lòng chọn file Excel/CSV')
      return
    }
    if (!createDataId) {
      setCreateError('Vui lòng đợi hệ thống đọc cột xong trước khi tạo dataset')
      return
    }

    setCreating(true)
    setCreateError('')
    try {
      const imageCol = createImageColumn || 'Url_image'
      const attrs =
        createAttrColumns && createAttrColumns.length > 0
          ? createAttrColumns
          : ['Occlusion', 'Expression', 'Illumination']

      const payload = {
        data_id: createDataId,
        name: createName || `AI Card ${new Date().toLocaleString('vi-VN')}`,
        description: createDescription || '',
        image_column: imageCol,
        attributes_columns: attrs,
      }

      const headers = {}
      if (currentUser && currentUser.username) {
        headers['X-Current-User'] = currentUser.username
      }

      const resp = await axios.post('/api/aicard/projects/create', payload, {
        headers,
      })

      const newProject = resp.data?.project

      const reload = await axios.get('/api/aicard/projects')
      const list = reload.data?.projects || []
      setProjects(list)

      if (newProject && newProject.id) {
        setSelectedProjectId(newProject.id)
      } else if (list.length > 0) {
        setSelectedProjectId(list[list.length - 1].id)
      }

      setCreateName('')
      setCreateDescription('')
      setCreateFile(null)
      setCreateColumns([])
      setCreateImageColumn('')
      setCreateAttrColumns(['Occlusion', 'Expression', 'Illumination'])
      setCreateDataId(null)
    } catch (err) {
      console.error('[AI Card] Lỗi tạo dataset', err)
      const msg = err?.response?.data?.error || 'Tạo dataset AI Card thất bại'
      setCreateError(msg)
    } finally {
      setCreating(false)
    }
  }

  const handleSelectProject = (projectId) => {
    setSelectedProjectId(projectId)
    setPage(1)
    setSearchInput('')
    setSearchTerm('')
    // bỏ filter theo TRAIN
    setAttrFilterKey('')
    setAttrFilterValue('')
    setPrimaryAttrFilterKey('')
    setPrimaryAttrFilterValue('')
  }

  const handleDeleteProject = async (projectId, projectName) => {
    if (!canEdit) return
    const confirmed = window.confirm(
      `Bạn có chắc muốn xóa dataset "${projectName || projectId}"? Hành động này không thể hoàn tác.`,
    )
    if (!confirmed) return

    try {
      const headers = {}
      if (currentUser && currentUser.username) {
        headers['X-Current-User'] = currentUser.username
      }

      await axios.delete(`/api/aicard/projects/${projectId}`, { headers })

      const wasSelected = selectedProjectId === projectId

      const reload = await axios.get('/api/aicard/projects')
      const list = reload.data?.projects || []
      setProjects(list)

      if (wasSelected) {
        if (list.length > 0) {
          setSelectedProjectId(list[0].id)
          setPage(1)
          setSearchInput('')
          setSearchTerm('')
          setSelectedFilter('all')
          setAttrFilterKey('')
          setAttrFilterValue('')
          setPrimaryAttrFilterKey('')
          setPrimaryAttrFilterValue('')
        } else {
          setSelectedProjectId(null)
          setCards([])
          setCardsTotal(0)
          setAttrFilterKey('')
          setAttrFilterValue('')
          setPrimaryAttrFilterKey('')
          setPrimaryAttrFilterValue('')
        }
      }
    } catch (err) {
      console.error('[AI Card] Lỗi xóa dataset', err)
      const msg = err?.response?.data?.error || 'Xóa dataset AI Card thất bại'
      window.alert(msg)
    }
  }

  const handleExportProject = () => {
    if (!selectedProjectId) return
    try {
      const url = `/api/aicard/projects/${selectedProjectId}/export`
      window.open(url, '_blank')
    } catch (err) {
      // fallback: không làm gì, tránh crash UI
      console.error('[AI Card] Lỗi mở link export', err)
    }
  }

  const handleToggleSelected = async (card) => {
    if (!canEdit || !selectedProjectId) return
    const current = !!(card.tags && card.tags.selected_for_training)
    const nextVal = !current

    setUpdatingRowId(card.row_id)
    try {
      const headers = {}
      if (currentUser && currentUser.username) {
        headers['X-Current-User'] = currentUser.username
      }

      await axios.patch(
        '/api/aicard/cards/bulk',
        {
          project_id: selectedProjectId,
          updates: [
            {
              row_id: card.row_id,
              tags: { selected_for_training: nextVal },
            },
          ],
        },
        { headers }
      )

      setCards((prev) =>
        prev.map((c) =>
          c.row_id === card.row_id
            ? {
                ...c,
                tags: {
                  ...(c.tags || {}),
                  selected_for_training: nextVal,
                },
              }
            : c
        )
      )
    } catch (err) {
      console.error('[AI Card] Lỗi cập nhật tag Ảnh đẹp', err)
    } finally {
      setUpdatingRowId(null)
    }
  }

  const handleToggleFilterLabel = async (card) => {
    if (!canEdit || !selectedProjectId) return

    const currentFilterRaw = card.attributes && (card.attributes.Filter ?? card.attributes.filter)
    const currentFilter = String(currentFilterRaw ?? '').trim() === '1' ? 1 : 0
    const nextFilter = currentFilter === 1 ? 0 : 1

    setUpdatingRowId(card.row_id)
    try {
      const headers = {}
      if (currentUser && currentUser.username) {
        headers['X-Current-User'] = currentUser.username
      }

      await axios.patch(
        '/api/aicard/cards/bulk',
        {
          project_id: selectedProjectId,
          updates: [
            {
              row_id: card.row_id,
              attributes: { Filter: nextFilter },
            },
          ],
        },
        { headers },
      )

      setCards((prev) =>
        prev.map((c) => {
          if (c.row_id !== card.row_id) return c
          const attrs = c.attributes || {}
          return {
            ...c,
            attributes: {
              ...attrs,
              Filter: nextFilter,
            },
          }
        }),
      )
    } catch (err) {
      console.error('[AI Card] Lỗi cập nhật nhãn Filter', err)
    } finally {
      setUpdatingRowId(null)
    }
  }

  const handleClickEventFilter = (label) => {
    const EVENT_COLUMN_NAME = 'Event'
    const labelStr = label === null || label === undefined ? '' : String(label)
    const isSame =
      primaryAttrFilterKey === EVENT_COLUMN_NAME &&
      String(primaryAttrFilterValue || '').toLowerCase() === labelStr.toLowerCase()

    setPage(1)
    if (isSame) {
      setPrimaryAttrFilterKey('')
      setPrimaryAttrFilterValue('')
    } else {
      setPrimaryAttrFilterKey(EVENT_COLUMN_NAME)
      setPrimaryAttrFilterValue(labelStr)
    }
  }

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null
  const totalPages = cardsTotal > 0 ? Math.ceil(cardsTotal / pageSize) : 1
  const startIndex = cardsTotal === 0 ? 0 : (page - 1) * pageSize + 1
  const endIndex = Math.min(cardsTotal, (page - 1) * pageSize + cards.length)
  const attributeFilterOptions = (selectedProject?.attributes_columns || []).filter(Boolean)

  const eventCountMap = {}
  cards.forEach((card) => {
    if (!card || !card.attributes) return
    const attrs = card.attributes || {}
    let eventValue
    Object.entries(attrs).forEach(([key, value]) => {
      if (eventValue === undefined && String(key).toLowerCase() === 'event') {
        eventValue = value
      }
    })
    if (eventValue === undefined) return

    const raw = eventValue === null || eventValue === undefined ? '' : String(eventValue)
    const parts = raw.includes(',') ? raw.split(',') : [raw]
    const labelsSet = new Set(
      parts
        .map((p) => p.trim())
        .filter(Boolean),
    )
    if (labelsSet.size === 0) {
      labelsSet.add('(trống)')
    }

    labelsSet.forEach((label) => {
      eventCountMap[label] = (eventCountMap[label] || 0) + 1
    })
  })
  const eventStats = Object.entries(eventCountMap)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([label, count]) => ({ label, count }))
  const totalEventsOnPage = eventStats.reduce((sum, item) => sum + item.count, 0)
  const eventColorClasses = [
    'bg-emerald-500',
    'bg-sky-500',
    'bg-amber-500',
    'bg-violet-500',
    'bg-rose-500',
    'bg-cyan-500',
  ]

  const filteredEventStats = eventStatsFull && eventStatsFull.events ? eventStatsFull.events : []
  const totalEventsFiltered =
    (eventStatsFull && typeof eventStatsFull.total_with_event === 'number'
      ? eventStatsFull.total_with_event
      : filteredEventStats.reduce((sum, item) => sum + (item.count || 0), 0)) || 0

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">AI Card</h2>
            <p className="text-sm text-gray-600 mt-1">
              Xem và duyệt dataset ảnh, gắn tag chọn mẫu training từ file Excel có cột Files.
            </p>
          </div>
        </div>

        <div className="mt-4 grid md:grid-cols-2 lg:grid-cols-5 gap-6">
          {/* 1/ Tạo dataset mới từ Excel (trái, nhỏ) */}
          <div className="lg:col-span-1 order-2 md:order-2 lg:order-1">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Tạo dataset mới từ Excel</h3>
            {!canEdit ? (
              <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
                Executive chỉ được xem AI Card. Chỉ Owner hoặc Admin mới được tạo dataset mới.
              </div>
            ) : (
              <form className="space-y-3" onSubmit={handleCreateSubmit}>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Tên dataset</label>
                  <input
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                    placeholder="VD: Bộ ảnh Occlusion 2025"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Mô tả</label>
                  <textarea
                    value={createDescription}
                    onChange={(e) => setCreateDescription(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm min-h-[60px]"
                    placeholder="Ghi chú ngắn về dataset này"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">File Excel/CSV</label>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileChange}
                    className="w-full text-xs"
                  />
                  <p className="mt-1 text-[11px] text-gray-500">
                    File cần có cột <span className="font-semibold">Files</span> chứa link ảnh. Các cột Occlusion,
                    Expression, Illumination sẽ được hiển thị trên card.
                  </p>
                  {createColumns.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Chọn cột ảnh</label>
                        <select
                          value={createImageColumn || 'Url_image'}
                          onChange={(e) => setCreateImageColumn(e.target.value)}
                          className="w-full px-2 py-2 border border-gray-300 rounded text-xs bg-white"
                        >
                          {createColumns.map((col) => (
                            <option key={col} value={col}>
                              {col}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Chọn các cột thuộc tính hiển thị trên card
                        </label>
                        <div className="max-h-32 overflow-y-auto border border-gray-200 rounded px-2 py-1 space-y-1 bg-white">
                          {createColumns.map((col) => {
                            const checked = createAttrColumns.includes(col)
                            return (
                              <label key={col} className="flex items-center gap-2 text-[11px] text-gray-700">
                                <input
                                  type="checkbox"
                                  className="w-3 h-3"
                                  checked={checked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setCreateAttrColumns((prev) =>
                                        prev.includes(col) ? prev : [...prev, col],
                                      )
                                    } else {
                                      setCreateAttrColumns((prev) => prev.filter((c) => c !== col))
                                    }
                                  }}
                                />
                                <span>{col}</span>
                              </label>
                            )
                          })}
                          {createColumns.length === 0 && (
                            <div className="text-[11px] text-gray-400">Chưa có thông tin cột, chọn file trước.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                {createError && <p className="text-xs text-red-600">{createError}</p>}
                <div>
                  <button
                    type="submit"
                    disabled={creating}
                    className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-60"
                  >
                    {creating ? 'Đang tạo dataset...' : 'Tạo AI Card dataset'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* 2/ Danh sách dataset (giữa, nhỏ) */}
          <div className="lg:col-span-1 order-1 md:order-1 lg:order-2">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Danh sách dataset</h3>
            <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto divide-y divide-gray-100">
              {loadingProjects ? (
                <div className="p-3 text-sm text-gray-500">Đang tải danh sách...</div>
              ) : projects.length === 0 ? (
                <div className="p-3 text-sm text-gray-500">
                  Chưa có dataset AI Card nào.
                </div>
              ) : (
                projects.map((p) => {
                  const isActive = p.id === selectedProjectId
                  return (
                    <div
                      key={p.id}
                      onClick={() => handleSelectProject(p.id)}
                      role="button"
                      tabIndex={0}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-colors cursor-pointer ${
                        isActive ? 'bg-primary-50 border-l-4 border-primary-500' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div>
                        <div className="font-medium text-gray-900">{p.name}</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {p.total_rows || 0} dòng • Cột ảnh: {p.image_column || 'Url_image'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-2">
                        <div className="text-[11px] text-gray-400">
                          {p.created_at ? new Date(p.created_at).toLocaleDateString('vi-VN') : ''}
                        </div>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteProject(p.id, p.name)
                            }}
                            className="inline-flex items-center px-2 py-1 rounded text-[10px] font-medium text-red-600 border border-red-200 hover:bg-red-50"
                          >
                            Xóa
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* 3/ Thống kê (phải, to nhất) */}
          <div className="lg:col-span-3 order-3">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Thống kê nhanh</h3>
            {selectedProject ? (
              <div className="bg-white border border-gray-200 rounded-lg p-4 text-xs text-gray-700 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-gray-900">{selectedProject.name}</div>
                  <div className="flex items-center gap-2 text-[11px] text-gray-500">
                    <span>
                      {selectedProject.created_at
                        ? new Date(selectedProject.created_at).toLocaleString('vi-VN')
                        : ''}
                    </span>
                    <button
                      type="button"
                      onClick={handleExportProject}
                      className="inline-flex items-center px-2 py-1 rounded border border-primary-600 text-primary-700 hover:bg-primary-50"
                    >
                      Export Excel (Ảnh đẹp)
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-1">
                  <div className="bg-primary-50 border border-primary-100 rounded-md px-3 py-2">
                    <div className="text-[11px] text-gray-500">Tổng dòng dataset</div>
                    <div className="text-sm font-semibold text-primary-700">
                      {selectedProject.total_rows ?? '-'}
                    </div>
                  </div>
                  <div className="bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
                    <div className="text-[11px] text-gray-500">Cards theo bộ lọc hiện tại</div>
                    <div className="text-sm font-semibold text-gray-800">{cardsTotal}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      Trang {page}/{totalPages} • Hiển thị {startIndex}-{endIndex}
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-[11px] text-gray-700">
                  <div className="font-semibold mb-1">Thống kê Event (bộ lọc hiện tại)</div>
                  {!filteredEventStats || filteredEventStats.length === 0 ? (
                    <div className="text-gray-400">Không có Event nào cho bộ lọc hiện tại.</div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {filteredEventStats.slice(0, 10).map((item, idx) => {
                          const count = item.count || 0
                          const percent = totalEventsFiltered ? Math.round((count * 100) / totalEventsFiltered) : 0
                          const colorClass = eventColorClasses[idx % eventColorClasses.length]
                          const label = item.label
                          const isActive =
                            primaryAttrFilterKey === 'Event' &&
                            String(primaryAttrFilterValue || '').toLowerCase() ===
                              String(label || '').toLowerCase()
                          return (
                            <div
                              key={label}
                              role="button"
                              tabIndex={0}
                              onClick={() => handleClickEventFilter(label)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  handleClickEventFilter(label)
                                }
                              }}
                              className={`flex items-center justify-between px-2 py-1 rounded-md border transition-colors cursor-pointer ${
                                isActive
                                  ? 'bg-primary-600 border-primary-700 text-white shadow-sm'
                                  : 'bg-primary-50/60 border-primary-100 hover:bg-primary-100'
                              }`}
                            >
                              <div className="mr-2 truncate">
                                <div
                                  className={`truncate font-medium ${
                                    isActive ? 'text-white' : 'text-gray-900'
                                  }`}
                                >
                                  {label}
                                </div>
                                <div
                                  className={`text-[10px] ${
                                    isActive ? 'text-primary-50/90' : 'text-gray-500'
                                  }`}
                                >
                                  {count} card • {percent}% trong các card có Event theo bộ lọc hiện tại
                                </div>
                                <div className="mt-1 h-1.5 rounded-full bg-primary-100 overflow-hidden">
                                  <div
                                    className={`h-full ${colorClass}`}
                                    style={{ width: `${Math.max(percent, 4)}%` }}
                                  />
                                </div>
                              </div>
                              <span className="px-2 py-0.5 rounded-full bg-white border border-primary-200 text-[10px] font-semibold text-primary-700">
                                {count}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                      {filteredEventStats.length > 10 && (
                        <div className="mt-1 text-gray-500">
                          +{filteredEventStats.length - 10} Event khác cho bộ lọc hiện tại
                        </div>
                      )}
                    </>
                  )}
                  {totalEventsFiltered ? (
                    <div className="mt-1 text-gray-500">
                      Tổng card có Event (theo bộ lọc hiện tại): {totalEventsFiltered}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="text-xs text-gray-400">Chọn một dataset ở giữa để xem thống kê.</div>
            )}
          </div>
        </div>
      </div>

      {selectedProject && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Cards của dataset: {selectedProject.name}</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Tổng {cardsTotal} dòng • Thuộc tính chính:{' '}
                {(selectedProject.attributes_columns || []).join(', ') || 'Occlusion, Expression, Illumination'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Tìm theo ID hoặc thuộc tính..."
                className="px-3 py-2 border border-gray-300 rounded text-xs min-w-[180px]"
              />
              <select
                value={selectedFilter}
                onChange={(e) => {
                  setPage(1)
                  setSelectedFilter(e.target.value)
                }}
                className="px-2 py-2 border border-gray-300 rounded text-xs bg-white"
              >
                <option value="all">Tất cả</option>
                <option value="selected">Đã chọn training</option>
                <option value="not_selected">Chưa chọn</option>
              </select>
              <select
                value={aspectMode}
                onChange={(e) => {
                  setPage(1)
                  setAspectMode(e.target.value)
                }}
                className="px-2 py-2 border border-gray-300 rounded text-xs bg-white"
              >
                <option value="square">Ảnh 1:1</option>
                <option value="video">Ảnh 16:9</option>
                <option value="auto">Theo ảnh</option>
              </select>
              <select
                value={primaryAttrFilterKey}
                onChange={(e) => {
                  const value = e.target.value
                  setPage(1)
                  setPrimaryAttrFilterKey(value)
                  if (!value) {
                    setPrimaryAttrFilterValue('')
                  }
                }}
                className="px-2 py-2 border border-gray-300 rounded text-xs bg-white min-w-[140px]"
              >
                <option value="">Primary filter</option>
                {attributeFilterOptions.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={primaryAttrFilterValue}
                onChange={(e) => {
                  setPage(1)
                  setPrimaryAttrFilterValue(e.target.value)
                }}
                disabled={!primaryAttrFilterKey}
                placeholder={
                  primaryAttrFilterKey
                    ? `Giá trị primary cho ${primaryAttrFilterKey}`
                    : 'Chọn cột primary để lọc'
                }
                className="px-3 py-2 border border-gray-300 rounded text-xs min-w-[180px] disabled:bg-gray-50 disabled:text-gray-400"
              />
              {primaryAttrFilterKey || primaryAttrFilterValue ? (
                <button
                  type="button"
                  onClick={() => {
                    setPrimaryAttrFilterKey('')
                    setPrimaryAttrFilterValue('')
                    setPage(1)
                  }}
                  className="px-2 py-1 rounded border border-gray-300 bg-white text-[11px] text-gray-700 hover:bg-gray-50"
                >
                  Xóa primary
                </button>
              ) : null}
              <select
                value={attrFilterKey}
                onChange={(e) => {
                  const value = e.target.value
                  setPage(1)
                  setAttrFilterKey(value)
                  // Nếu bỏ chọn cột thì reset luôn giá trị filter
                  if (!value) {
                    setAttrFilterValue('')
                  }
                }}
                className="px-2 py-2 border border-gray-300 rounded text-xs bg-white min-w-[140px]"
              >
                <option value="">Lọc theo thuộc tính</option>
                {attributeFilterOptions.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={attrFilterValue}
                onChange={(e) => {
                  setPage(1)
                  setAttrFilterValue(e.target.value)
                }}
                disabled={!attrFilterKey}
                placeholder={attrFilterKey ? `Giá trị cho ${attrFilterKey}` : 'Chọn cột trước để lọc'}
                list={attrFilterKey ? 'aicard-attr-values' : undefined}
                className="px-3 py-2 border border-gray-300 rounded text-xs min-w-[180px] disabled:bg-gray-50 disabled:text-gray-400"
              />
              {attrFilterKey && attrValueOptions && attrValueOptions.length > 0 && (
                <datalist id="aicard-attr-values">
                  {attrValueOptions.map((opt) => (
                    <option key={opt.value} value={opt.value} />
                  ))}
                </datalist>
              )}
              {attrFilterKey || attrFilterValue ? (
                <button
                  type="button"
                  onClick={() => {
                    setAttrFilterKey('')
                    setAttrFilterValue('')
                    setPage(1)
                  }}
                  className="px-2 py-1 rounded border border-gray-300 bg-white text-[11px] text-gray-700 hover:bg-gray-50"
                >
                  Xóa filter
                </button>
              ) : null}
            </div>
          </div>

          {cardsError && <p className="text-xs text-red-600">{cardsError}</p>}

          {loadingCards ? (
            <div className="py-8 text-sm text-gray-500">Đang tải danh sách card...</div>
          ) : cards.length === 0 ? (
            <div className="py-8 text-sm text-gray-500">Không có card nào phù hợp với bộ lọc hiện tại.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              {cards.map((card) => {
                const isSelected = !!(card.tags && card.tags.selected_for_training)
                const attrs = card.attributes || {}
                const entries = Object.entries(attrs).slice(0, 3)
                const aspectClass =
                  aspectMode === 'square' ? 'aspect-square' : aspectMode === 'video' ? 'aspect-video' : ''
                return (
                  <div
                    key={card.row_id}
                    className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm flex flex-col"
                  >
                    {card.image_url ? (
                      <div
                        className={`${aspectClass} bg-gray-100 rounded-lg overflow-hidden mb-2 cursor-zoom-in`}
                        onClick={() => setPreviewCard(card)}
                      >
                        <img
                          src={card.image_url}
                          alt={String(card.id_value ?? card.row_id ?? '')}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="aspect-video bg-gray-100 rounded-lg mb-2 flex items-center justify-center text-[11px] text-gray-400">
                        Không có ảnh
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[11px] text-gray-700 mb-1">
                      <span className="font-mono">
                        ID: {card.id_value !== null && card.id_value !== undefined ? card.id_value : card.row_id}
                      </span>
                      {isSelected && (
                        <span className="px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 text-[10px] font-semibold">
                          Ảnh đẹp
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-700 space-y-0.5 mb-2">
                      {entries.length === 0 ? (
                        <span className="text-gray-400">Không có thuộc tính để hiển thị.</span>
                      ) : (
                        entries.map(([key, value]) => (
                          <div key={key}>
                            <span className="font-semibold">{key}:</span>{' '}
                            <span>{value === null || value === undefined ? '' : String(value)}</span>
                          </div>
                        ))
                      )}
                    </div>
                    {canEdit && (
                      <div className="mt-auto flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleSelected(card)}
                          disabled={updatingRowId === card.row_id}
                          className={`inline-flex flex-1 items-center justify-center px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            isSelected
                              ? 'bg-primary-600 text-white border-primary-600 hover:bg-primary-700'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          } ${updatingRowId === card.row_id ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                          {updatingRowId === card.row_id
                            ? 'Đang lưu...'
                            : isSelected
                            ? 'Bỏ Ảnh đẹp'
                            : 'Ảnh đẹp'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleFilterLabel(card)}
                          disabled={updatingRowId === card.row_id}
                          className={`inline-flex w-16 items-center justify-center px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            updatingRowId === card.row_id
                              ? 'opacity-60 cursor-not-allowed bg-white text-gray-400 border-gray-200'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          Filter {(() => {
                            const raw = card.attributes && (card.attributes.Filter ?? card.attributes.filter)
                            const val = String(raw ?? '').trim() === '1' ? 1 : 0
                            return val
                          })()}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between text-xs text-gray-600 gap-2">
            <div>
              {cardsTotal === 0 ? (
                <span>Không có dữ liệu.</span>
              ) : (
                <span>
                  Hiển thị {startIndex}-{endIndex}/{cardsTotal} card
                </span>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1 rounded border border-gray-300 bg-white disabled:opacity-50 text-xs"
              >
                Trước
              </button>
              <span>
                Trang {page}/{totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1 rounded border border-gray-300 bg-white disabled:opacity-50 text-xs"
              >
                Sau
              </button>
            </div>
          </div>
        </div>
      )}

      {previewCard && previewCard.image_url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4"
          onClick={() => setPreviewCard(null)}
        >
          <div
            className="inline-flex flex-col max-w-[95vw] max-h-[95vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-1.5 rounded-t-md bg-black/70 text-gray-100 text-xs">
              <div>
                ID:{' '}
                {previewCard.id_value !== null && previewCard.id_value !== undefined
                  ? previewCard.id_value
                  : previewCard.row_id}
              </div>
              <button
                type="button"
                onClick={() => setPreviewCard(null)}
                className="px-2 py-0.5 rounded border border-gray-400/70 hover:bg-gray-200/20 text-[11px]"
              >
                Đóng
              </button>
            </div>
            <div className="flex items-center justify-center p-2 bg-black/90 rounded-b-md">
              <img
                src={previewCard.image_url}
                alt={String(previewCard.id_value ?? previewCard.row_id ?? '')}
                className="max-h-[88vh] max-w-[95vw] w-auto h-auto object-contain rounded-md shadow-xl"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AiCardPage
