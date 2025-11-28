import React, { useEffect, useState } from 'react'
import axios from 'axios'
import { Users, Shield, PlusCircle, RefreshCw, Lock, Trash2, Settings } from 'lucide-react'

const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'executive', label: 'Executive' }
]

const roleLabel = (role) => {
  const found = ROLE_OPTIONS.find((r) => r.value === role)
  return found ? found.label : role
}

const PERMISSION_LABELS = {
  access_workflow: 'Truy cập QA data',
  access_labeling: 'Truy cập Label data',
  access_compare: 'Truy cập Compare data',
  access_projects: 'Truy cập Projects',
  create_project: 'Tạo project',
  delete_project: 'Xóa project',
  access_ai_card: 'Truy cập AI Card',
  edit_ai_card: 'Chỉnh sửa AI Card',
  manage_users: 'Quản lý users'
}

const permissionLabel = (code) => PERMISSION_LABELS[code] || code

const ManageUsers = () => {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [creating, setCreating] = useState(false)
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'executive' })

  const [passwordEdits, setPasswordEdits] = useState({})

  const [allPermissions, setAllPermissions] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [editingPerms, setEditingPerms] = useState([])
  const [showPermModal, setShowPermModal] = useState(false)

  // Lấy current user từ localStorage (FE đang lưu thông tin login tại đây)
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

  const loadUsers = async () => {
    setLoading(true)
    setError('')
    try {
      const resp = await axios.get('/api/users')
      setUsers(resp.data?.users || [])
      setAllPermissions(resp.data?.all_permissions || [])
    } catch (e) {
      console.error('Load users error', e)
      setError('Không tải được danh sách user.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!newUser.username.trim() || !newUser.password.trim()) {
      alert('Username và password không được để trống')
      return
    }
    setCreating(true)
    setError('')
    try {
      await axios.post('/api/users', {
        username: newUser.username.trim(),
        password: newUser.password,
        role: newUser.role
      })
      setNewUser({ username: '', password: '', role: 'executive' })
      await loadUsers()
    } catch (e) {
      console.error('Create user error', e)
      const msg = e?.response?.data?.error || 'Lỗi khi tạo user'
      alert(msg)
      setError(msg)
    } finally {
      setCreating(false)
    }
  }

  const updateUserRole = async (user, role) => {
    try {
      await axios.patch(`/api/users/${user.id}`, { role })
      await loadUsers()
    } catch (e) {
      console.error('Update role error', e)
      alert(e?.response?.data?.error || 'Lỗi khi cập nhật role')
    }
  }

  const updateUserActive = async (user, isActive) => {
    try {
      await axios.patch(`/api/users/${user.id}`, { is_active: isActive })
      await loadUsers()
    } catch (e) {
      console.error('Update active error', e)
      alert(e?.response?.data?.error || 'Lỗi khi cập nhật trạng thái')
    }
  }

  const resetPassword = async (userId) => {
    const pwd = (passwordEdits[userId] || '').trim()
    if (!pwd) {
      alert('Nhập mật khẩu mới trước khi đặt lại')
      return
    }
    try {
      await axios.patch(`/api/users/${userId}`, { password: pwd })
      setPasswordEdits((prev) => ({ ...prev, [userId]: '' }))
      alert('Đã đặt lại mật khẩu')
    } catch (e) {
      console.error('Reset password error', e)
      alert(e?.response?.data?.error || 'Lỗi khi đặt lại mật khẩu')
    }
  }

  const openPermissions = (user) => {
    if (!currentUser || currentUser.role !== 'owner') {
      alert('Chỉ Owner mới được phép xem/chỉnh quyền chi tiết.')
      return
    }

    setSelectedUser(user)
    const currentPerms = Array.isArray(user.permissions) ? user.permissions : []
    setEditingPerms(currentPerms)
    setShowPermModal(true)
  }

  const togglePermission = (code) => {
    setEditingPerms((prev) => {
      if (prev.includes(code)) {
        return prev.filter((p) => p !== code)
      }
      return [...prev, code]
    })
  }

  const savePermissions = async () => {
    if (!selectedUser) return

    try {
      await axios.patch(`/api/users/${selectedUser.id}`, {
        permissions: editingPerms
      })
      await loadUsers()
      setShowPermModal(false)
      setSelectedUser(null)
    } catch (e) {
      console.error('Update permissions error', e)
      alert(e?.response?.data?.error || 'Lỗi khi cập nhật quyền')
    }
  }

  const handleDeleteUser = async (user) => {
    if (!currentUser || currentUser.role !== 'owner') {
      alert('Chỉ Owner mới được phép xóa user.')
      return
    }

    if (currentUser.username === user.username) {
      alert('Owner không thể tự xóa tài khoản của mình.')
      return
    }

    if (!window.confirm(`Bạn có chắc chắn muốn xóa user "${user.username}"?`)) {
      return
    }

    try {
      await axios.delete(`/api/users/${user.id}`, {
        headers: {
          'X-Current-User': currentUser.username
        }
      })
      await loadUsers()
      alert('Đã xóa user thành công.')
    } catch (e) {
      console.error('Delete user error', e)
      alert(e?.response?.data?.error || 'Lỗi khi xóa user')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center space-x-2">
            <Users className="w-6 h-6 text-primary-600" />
            <span>Manage users</span>
          </h2>
          <p className="text-gray-600 text-sm mt-1">
            Quản lý tài khoản và phân quyền (Owner / Admin / Executive).
          </p>
        </div>

        <button
          type="button"
          onClick={loadUsers}
          className="flex items-center space-x-2 px-3 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Làm mới</span>
        </button>
      </div>

      {/* Tạo user mới */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center space-x-2">
          <PlusCircle className="w-4 h-4 text-primary-600" />
          <span>Tạo tài khoản mới</span>
        </h3>
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Username</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              value={newUser.username}
              onChange={(e) => setNewUser((prev) => ({ ...prev, username: e.target.value }))}
              placeholder="vd: alice"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              value={newUser.password}
              onChange={(e) => setNewUser((prev) => ({ ...prev, password: e.target.value }))}
              placeholder="ít nhất 6 ký tự"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-white"
              value={newUser.role}
              onChange={(e) => setNewUser((prev) => ({ ...prev, role: e.target.value }))}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <button
              type="submit"
              disabled={creating}
              className="w-full inline-flex items-center justify-center px-3 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-60"
            >
              {creating ? 'Đang tạo...' : 'Tạo user'}
            </button>
          </div>
        </form>
      </div>

      {/* Danh sách user */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center space-x-2">
          <Shield className="w-4 h-4 text-primary-600" />
          <span>Danh sách tài khoản</span>
        </h3>

        {error && (
          <div className="mb-3 text-xs text-red-600">{error}</div>
        )}

        {loading ? (
          <p className="text-sm text-gray-500">Đang tải danh sách user...</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-500">Chưa có user nào.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Username</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Role</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Trạng thái</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Tạo lúc</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Đổi mật khẩu</th>
                  {currentUser && currentUser.role === 'owner' && (
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Thao tác</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-gray-200 hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 font-mono text-gray-800">{u.username}</td>
                    <td className="px-3 py-2">
                      <select
                        className="px-2 py-1 border border-gray-300 rounded bg-white text-xs"
                        value={u.role}
                        onChange={(e) => updateUserRole(u, e.target.value)}
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center space-x-1 text-xs text-gray-700">
                        <input
                          type="checkbox"
                          className="rounded border-gray-300"
                          checked={u.is_active !== false}
                          onChange={(e) => updateUserActive(u, e.target.checked)}
                        />
                        <span>{u.is_active === false ? 'Inactive' : 'Active'}</span>
                      </label>
                    </td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                      {u.created_at ? new Date(u.created_at).toLocaleString('vi-VN') : '-'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center space-x-2">
                        <input
                          type="password"
                          className="px-2 py-1 border border-gray-300 rounded text-xs"
                          placeholder="Mật khẩu mới"
                          value={passwordEdits[u.id] || ''}
                          onChange={(e) =>
                            setPasswordEdits((prev) => ({ ...prev, [u.id]: e.target.value }))
                          }
                        />
                        <button
                          type="button"
                          onClick={() => resetPassword(u.id)}
                          className="inline-flex items-center px-2 py-1 bg-primary-600 text-white rounded text-xs font-medium hover:bg-primary-700"
                        >
                          <Lock className="w-3 h-3 mr-1" />
                          <span>Đặt lại</span>
                        </button>
                      </div>
                    </td>
                    {currentUser && currentUser.role === 'owner' && (
                      <td className="px-3 py-2">
                        {currentUser.username !== u.username ? (
                          <div className="flex flex-col space-y-1">
                            <button
                              type="button"
                              onClick={() => openPermissions(u)}
                              className="inline-flex items-center px-2 py-1 bg-gray-700 text-white rounded text-xs font-medium hover:bg-gray-900"
                            >
                              <Settings className="w-3 h-3 mr-1" />
                              <span>Quyền</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(u)}
                              className="inline-flex items-center px-2 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700"
                            >
                              <Trash2 className="w-3 h-3 mr-1" />
                              <span>Xóa</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-400 italic">Không thể tự xóa</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showPermModal && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
                  <Settings className="w-4 h-4 text-primary-600" />
                  <span>Quyền của user: {selectedUser.username}</span>
                </h3>
                <p className="text-xs text-gray-500 mt-1">Chỉ Owner được chỉnh sửa quyền chi tiết.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowPermModal(false)
                  setSelectedUser(null)
                }}
                className="text-xs px-2 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
              >
                Đóng
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-md p-3 space-y-1">
              {allPermissions.length === 0 ? (
                <p className="text-xs text-gray-500">Chưa cấu hình danh sách quyền.</p>
              ) : (
                allPermissions.map((code) => (
                  <label key={code} className="flex items-center justify-between text-xs py-1">
                    <span className="text-gray-800">{permissionLabel(code)}</span>
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      checked={editingPerms.includes(code)}
                      onChange={() => togglePermission(code)}
                    />
                  </label>
                ))
              )}
            </div>

            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => {
                  setShowPermModal(false)
                  setSelectedUser(null)
                }}
                className="text-xs px-3 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={savePermissions}
                className="text-xs px-3 py-1 rounded bg-primary-600 text-white hover:bg-primary-700"
              >
                Lưu quyền
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ManageUsers
