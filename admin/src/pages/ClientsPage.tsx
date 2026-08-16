
import { useState, useMemo, useEffect, useCallback } from "react"
import AppNavbar from "@/components/AppNavbar.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Users,
  PhoneCall,
  Target,
  AlertCircle,
  Search,
  UploadCloud,
  FileSpreadsheet,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Filter,
  Download,
  ArrowRight,
  CheckCircle2,
  Edit,
  Trash2,
  Loader2,
  Plus,
} from "lucide-react"
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, LabelList } from "recharts"
import { toast, Toaster } from "sonner"
import { clientsApi, type Owner, type Agent, type Project, type StatusCount, type CallRecord } from "@/lib/clients-api.ts"
import * as XLSX from "xlsx"

// --- SHARED CHART PALETTE ---
const chartPalette = {
  dial: "#0077BE",
  connect: "#0D9488",
  interest: "#F59E0B",
  convert: "#4F46E5",
  miss: "#FB7185",
  neutral: "#94A3B8",
  emerald: "#10B981"
}

// Mapping from internal client to display-friendly shape
interface DisplayClient {
  id: string
  name: string
  primaryNumber: string
  status: string
  attemptCount: number
  lastDialedAt: string | null
  nextDialAt: string | null
  assignedAgent: string
  projects: string[]
  info: { key: string; value: string }[]
  history: { id: number; time: string; status: string; duration: number; agent: string; notes: string }[]
  // Keep the raw owner for API operations
  _raw: Owner
}

const systemFields = ["Primary Phone", "Client Name", "Status", "Project", "Attempts", "Assigned Agent", "Next Dial"]

// --- UTILS ---
const getStatusColor = (status: string) => {
  const s = status.toLowerCase()
  if (s === 'new' || s === 'dial') return 'bg-blue-100 text-blue-800 border-blue-200'
  if (s === 'interested' || s === 'callback') return 'bg-amber-100 text-amber-800 border-amber-200'
  if (s === 'closed' || s === 'answered') return 'bg-emerald-100 text-emerald-800 border-emerald-200'
  if (s === 'do not call' || s === 'not_interested') return 'bg-rose-100 text-rose-800 border-rose-200'
  if (s === 'voicemail' || s === 'no_answer') return 'bg-slate-100 text-slate-800 border-slate-200'
  if (s === 'busy') return 'bg-orange-100 text-orange-800 border-orange-200'
  if (s === 'failed') return 'bg-red-100 text-red-800 border-red-200'
  return 'bg-gray-100 text-gray-800 border-gray-200'
}

const formatStatus = (status: string) => {
  return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

// Helper to convert Excel letters (A, B, AA) to zero-based index (0, 1, 26)
const letterToIndex = (letters: string) => {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

// Helper to convert Owner API response to display client
function ownerToDisplayClient(owner: Owner): DisplayClient {
  const firstProject = owner.projects?.[0]
  return {
    id: owner.id.toString(),
    name: owner.name || "Unknown Client",
    primaryNumber: owner.phones?.[0]?.phone || "",
    status: firstProject?.status ? formatStatus(firstProject.status) : "New",
    attemptCount: firstProject?.attempt_count ?? 0,
    lastDialedAt: firstProject?.last_dialed_at ?? null,
    nextDialAt: owner.next_dial_at ?? null,
    assignedAgent: "—", // Not tracked in current API
    projects: owner.projects?.map(p => p.project_name) ?? [],
    info: owner.info?.map(i => ({ key: i.key, value: i.value })) ?? [],
    history: [], // Loaded on demand
    _raw: owner,
  }
}

export default function ClientsPage() {
  // --- DATA STATE ---
  const [clients, setClients] = useState<DisplayClient[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [allProjects, setAllProjects] = useState<Project[]>([])
  const [statusCounts, setStatusCounts] = useState<StatusCount[]>([])
  const [totalClients, setTotalClients] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("All")
  // Type filter: "" = All, "OWNER" = Owners only, "LEAD" = Leads only
  const [typeFilter, setTypeFilter] = useState("")
  const [currentPage, setCurrentPage] = useState(1)

  const ITEMS_PER_PAGE = 10

  // Modals
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [isAssignOpen, setIsAssignOpen] = useState(false)

  // View/Edit/Delete State
  const [selectedClient, setSelectedClient] = useState<DisplayClient | null>(null)
  const [selectedClientHistory, setSelectedClientHistory] = useState<CallRecord[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [editingClient, setEditingClient] = useState<DisplayClient | null>(null)
  const [editingPhones, setEditingPhones] = useState<string[]>([])
  const [deletingClientId, setDeletingClientId] = useState<string | null>(null)

  // CSV Mapping State
  const [uploadStep, setUploadStep] = useState<1 | 2>(1)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadAgent, setUploadAgent] = useState("")
  const [uploadNextDialAt, setUploadNextDialAt] = useState("")
  const [startRow, setStartRow] = useState<number>(2)
  const [endRow, setEndRow] = useState<string>("")
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({})
  const [phoneFields, setPhoneFields] = useState<string[]>(["Primary Phone"])
  const [excelHeaders, setExcelHeaders] = useState<{ label: string; letter: string }[]>([])

  // --- API: Load all data on mount ---
  const loadClients = useCallback(async (page = 1, type?: string) => {
    try {
      setIsLoading(true)
      const data = await clientsApi.getClients(page, ITEMS_PER_PAGE, type || undefined)
      const owners: Owner[] = data.data
      setClients(owners.map(ownerToDisplayClient))
      setTotalClients(data.meta.total)
    } catch (error: any) {
      toast.error("Failed to Load Clients", { description: error.message })
    } finally {
      setIsLoading(false)
    }
  }, [])

  const loadAgents = useCallback(async () => {
    try {
      const data = await clientsApi.getAgents()
      setAgents(data.map((a) => ({ id: a.id, name: a.name || a.email || "Unknown Agent", email: a.email })))
    } catch (error: any) {
      console.error("Failed to load agents:", error)
    }
  }, [])

  const loadStatusCounts = useCallback(async () => {
    try {
      const data = await clientsApi.getStatusCounts()
      setStatusCounts(data)
    } catch (error: any) {
      console.error("Failed to load status counts:", error)
    }
  }, [])

  const loadProjects = useCallback(async () => {
    try {
      const data = await clientsApi.getProjects()
      setAllProjects(data)
    } catch (error: any) {
      console.error("Failed to load projects:", error)
    }
  }, [])

  useEffect(() => {
    loadClients(1, typeFilter)
    loadAgents()
    loadStatusCounts()
    loadProjects()
  }, [loadClients, loadAgents, loadStatusCounts, loadProjects])

  // Reload clients when page or typeFilter changes; reset to page 1 on filter change
  useEffect(() => {
    loadClients(currentPage, typeFilter)
  }, [currentPage, typeFilter, loadClients])

  // --- Load call history for selected client ---
  const loadClientHistory = async (clientId: string) => {
    setIsLoadingHistory(true)
    try {
      const data = await clientsApi.getClientCallHistory(clientId)
      setSelectedClientHistory(data.data || [])
    } catch (error) {
      console.error("Failed to load call history:", error)
    } finally {
      setIsLoadingHistory(false)
    }
  }

  // --- DYNAMIC CHART DATA ---
  const statusDistribution = useMemo(() => {
    const colorMap: Record<string, string> = {
      'dial': chartPalette.dial,
      'new': chartPalette.dial,
      'callback': chartPalette.interest,
      'interested': chartPalette.interest,
      'answered': chartPalette.convert,
      'closed': chartPalette.convert,
      'no_answer': chartPalette.neutral,
      'voicemail': chartPalette.neutral,
      'not_interested': chartPalette.miss,
      'do not call': chartPalette.miss,
      'busy': '#F97316',
      'failed': '#EF4444',
    }

    return statusCounts
      .filter(s => s.count > 0)
      .map(s => ({
        name: formatStatus(s.status),
        value: s.count,
        color: colorMap[s.status.toLowerCase()] || chartPalette.neutral
      }))
  }, [statusCounts])

  const projectVolume = useMemo(() => {
    // Count clients per project from current page data — or use allProjects as labels
    // For a better experience, count from status counts or just show project names
    // Since we don't have a dedicated project-volume endpoint, we'll derive from loaded clients
    const projectMap = new Map<string, number>()
    clients.forEach(c => {
      c.projects.forEach(p => {
        projectMap.set(p, (projectMap.get(p) || 0) + 1)
      })
    })
    // Add projects from allProjects that may not be in current page
    allProjects.forEach(p => {
      if (!projectMap.has(p.name)) {
        projectMap.set(p.name, 0)
      }
    })
    return Array.from(projectMap.entries()).map(([name, clients]) => ({ name, clients }))
  }, [clients, allProjects])

  // --- FILTERING (client-side on current page) ---
  const filteredClients = useMemo(() => {
    return clients.filter(client => {
      const matchesSearch = client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            client.primaryNumber.includes(searchTerm)
      const matchesStatus = statusFilter === "All" || client.status.toLowerCase() === statusFilter.toLowerCase()
      return matchesSearch && matchesStatus
    })
  }, [searchTerm, statusFilter, clients])

  const totalPages = Math.ceil(totalClients / ITEMS_PER_PAGE) || 1
  // When filtering client-side, show filtered results from current page
  const paginatedClients = searchTerm || statusFilter !== "All" ? filteredClients : clients

  // --- KPI calculations from status counts ---
  const totalClientsCount = statusCounts.reduce((sum, s) => sum + s.count, 0) || totalClients
  const freshClients = statusCounts.find(s => s.status.toLowerCase() === 'dial')?.count ?? 0
  const closedClients = statusCounts.find(s => ['answered', 'closed'].includes(s.status.toLowerCase()))?.count ?? 0
  const overdueCount = clients.filter(l => l.nextDialAt && new Date(l.nextDialAt) < new Date()).length

  // --- CRUD HANDLERS ---
  const handleUpdateClient = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingClient) return

    const phones = editingPhones.map(p => p.trim()).filter(p => p !== "")
    if (phones.length === 0) {
      return toast.error("Phone Required", { description: "At least one phone number is required." })
    }

    try {
      const ownerId = Number(editingClient.id)
      await clientsApi.updateClient(ownerId, {
        type: editingClient._raw.type,
        next_dial_at: editingClient.nextDialAt || null,
        phones,
      })

      setEditingClient(null)
      toast.success("Client Updated", { description: "The client details have been saved." })
      loadClients(currentPage, typeFilter)
      loadStatusCounts()
    } catch (error: any) {
      toast.error("Update Failed", { description: error.message })
    }
  }

  const openEditClient = (client: DisplayClient) => {
    setEditingPhones(client._raw.phones?.map(p => p.phone) ?? [])
    setEditingClient({ ...client })
  }

  const addEditingPhone = () => setEditingPhones(prev => [...prev, ""])
  const updateEditingPhone = (index: number, value: string) =>
    setEditingPhones(prev => prev.map((p, i) => (i === index ? value : p)))
  const removeEditingPhone = (index: number) =>
    setEditingPhones(prev => prev.filter((_, i) => i !== index))

  const handleDeleteClient = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!deletingClientId) return

    try {
      await clientsApi.deleteClient(deletingClientId)

      setDeletingClientId(null)
      toast.success("Client Deleted", { description: "The client has been permanently removed." })
      loadClients(currentPage, typeFilter)
      loadStatusCounts()
    } catch (error: any) {
      toast.error("Delete Failed", { description: error.message })
    }
  }

  // --- CSV EXPORT ---
  const exportToCSV = () => {
    const headers = ["ID", "Client Name", "Primary Phone", "Status", "Projects", "Attempts", "Next Dial"]
    const csvContent = [
      headers.join(","),
      ...filteredClients.map(l => [
        l.id,
        `"${l.name}"`,
        `"\t${l.primaryNumber}"`,
        `"${l.status}"`,
        `"${l.projects.join(';')}"`,
        l.attemptCount,
        `"\t${l.nextDialAt || ''}"`
      ].join(","))
    ].join("\n")

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.setAttribute('href', url)
    a.setAttribute('download', `clients_export_${new Date().toISOString().split('T')[0]}.csv`)
    a.click()

    toast.success("Export Complete", { description: "Your CSV file has been downloaded." })
  }

  // --- UPLOAD / ASSIGN HANDLERS ---
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null
    if (file && !file.name.endsWith('.csv') && !file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      toast.error("Format Not Supported", { description: "Please upload a .csv or .xlsx file."})
      e.target.value = ""
      return
    }
    setUploadFile(file)
  }

  const resetModals = () => {
    setIsUploadOpen(false)
    setIsAssignOpen(false)
    setUploadStep(1)
    setUploadFile(null)
    setUploadAgent("")
    setUploadNextDialAt("")
    setColumnMapping({})
    setStartRow(2)
    setEndRow("")
    setPhoneFields(["Primary Phone"])
    setExcelHeaders([])
  }

  const indexToLetter = (index: number): string => {
    let result = '';
    let i = index;
    while (i >= 0) {
      result = String.fromCharCode((i % 26) + 65) + result;
      i = Math.floor(i / 26) - 1;
    }
    return result;
  }

  const parseExcelHeaders = async () => {
    if (!uploadFile) return;
    try {
      const buffer = await uploadFile.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1, raw: false });
      const headerRow = rows[0];
      if (headerRow && headerRow.length > 0) {
        const headers = headerRow.map((cell, idx) => ({
          label: cell ? String(cell).trim() : `Column ${indexToLetter(idx)}`,
          letter: indexToLetter(idx),
        })).filter(h => h.label !== '');
        setExcelHeaders(headers);
      } else {
        setExcelHeaders([]);
        toast.error("Could not read headers", { description: "The first row of your file appears to be empty." });
      }
    } catch (err) {
      console.error("Failed to parse headers:", err);
      setExcelHeaders([]);
      toast.error("Failed to read file headers.");
    }
  }

  const handleGoToMapping = async () => {
    await parseExcelHeaders();
    setUploadStep(2);
  }

  const handleAddPhoneField = () => {
    setPhoneFields(prev => [...prev, `Phone ${prev.length + 1}`])
  }

  // --- REAL CSV/XLSX PARSING ENGINE (now calls API) ---
  const handleFinalSubmit = (e: React.FormEvent, mode: "upload" | "assign") => {
    e.preventDefault()
    if (mode === "assign" && !uploadAgent) {
      return toast.error("Missing Agent", { description: "Please assign an agent to these clients." })
    }
    if (!uploadFile) return;

    const promise = new Promise(async (resolve, reject) => {
      try {
        const buffer = await uploadFile.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1, raw: false });
        const validRows = rows.filter(row => row && row.length > 0);

        const startIndex = Math.max(0, startRow - 1);
        const endIndex = endRow ? Math.min(validRows.length, parseInt(endRow)) : validRows.length;

        const ownersToCreate: any[] = [];

        for (let i = startIndex; i < endIndex; i++) {
          const row = validRows[i];
          if (!row) continue;

          const getVal = (fieldName: string) => {
            const letter = columnMapping[fieldName];
            if (!letter) return "";
            const idx = letterToIndex(letter);
            const val = row[idx];
            return val ? String(val).trim() : "";
          }

          // Loop through all dynamically created phone columns
          const rawPhones = phoneFields
            .map(field => getVal(field))
            .filter(phone => !!phone) // Remove empty strings
            .map(phone => phone.replace(/\t/g, '')); // Clean export garbage

          if (rawPhones.length === 0) continue; // Requires at least one valid phone

          ownersToCreate.push({
            name: getVal("Client Name") || "Unknown Client",
            phones: rawPhones.map(phone => ({ phone })),
            type: "OWNER",
            info: [],
          });
        }

        if (ownersToCreate.length === 0) {
          reject("No valid clients found in the file.");
          return;
        }

        const created = await clientsApi.bulkCreateClients(ownersToCreate);
        resolve(created.length);
      } catch (err) {
        reject(err);
      }
    });

    toast.promise(promise, {
      loading: 'Parsing file and importing clients...',
      success: (count) => {
        resetModals()
        loadClients(currentPage, typeFilter)
        loadStatusCounts()
        return `Successfully imported ${count} valid clients into the system.`
      },
      error: (err) => `Failed to process clients file: ${err}`
    })
  }

  // Active (non-deactivated) agents for assignment dropdowns
  const activeAgents = useMemo(() => agents.filter(a => (a.name || a.email) && !['deactivated'].includes((a.role || '').toLowerCase())), [agents])

  const renderMappingUI = (mode: "upload" | "assign") => {
    // Exclude 'Assigned Agent' and 'Next Dial' from column mapping — they get dedicated inputs
    const columnMappableFields = systemFields.filter(f => f !== "Assigned Agent" && f !== "Next Dial");
    const activeFields = mode === "assign" ? columnMappableFields.filter(f => f !== "Assigned Agent") : columnMappableFields;
    const otherFields = activeFields.filter(f => f !== "Primary Phone");

    return (
      <div className="space-y-6 pt-4 animate-in fade-in slide-in-from-right-4 duration-300">
        <div className="flex gap-4">
          <div className="space-y-2 flex-1">
            <Label>Start Row</Label>
            <Input type="number" min={1} value={startRow} onChange={(e) => setStartRow(Number(e.target.value))} className="h-10" />
          </div>
          <div className="space-y-2 flex-1">
            <Label>End Row</Label>
            <Input type="number" min={1} placeholder="Optional (EOF)" value={endRow} onChange={(e) => setEndRow(e.target.value)} className="h-10" />
          </div>
        </div>

        <div className="space-y-4 border-t pt-6 border-slate-100">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <Label className="text-xs text-slate-500 uppercase tracking-wider font-bold">Map File Columns</Label>
            <Button type="button" variant="outline" size="sm" onClick={handleAddPhoneField} className="h-7 px-2 text-xs flex items-center gap-1 text-emerald-600 border-emerald-200 hover:bg-emerald-50">
              <Plus className="h-3.5 w-3.5" /> Add Phone Column
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-4">Select the column from your file that matches each system field.</p>

          {[...phoneFields, ...otherFields].map(field => {
            // Collect all column letters already used by OTHER fields
            const usedByOthers = new Set(
              Object.entries(columnMapping)
                .filter(([f, v]) => f !== field && v)
                .map(([, v]) => v)
            );

            return (
              <div key={field} className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-slate-700 w-1/2">
                  {field} {field === "Primary Phone" && <span className="text-red-500">*</span>}
                </span>

                <select
                  className="flex h-10 w-1/2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 cursor-pointer"
                  value={columnMapping[field] || ""}
                  onChange={(e) => {
                    setColumnMapping(prev => ({...prev, [field]: e.target.value}));
                  }}
                >
                  <option value="">— Select column —</option>
                  {excelHeaders
                    .filter(h => !usedByOthers.has(h.letter))
                    .map(h => (
                      <option key={h.letter} value={h.letter}>{h.label} ({h.letter})</option>
                    ))}
                </select>
              </div>
            );
          })}
        </div>

        {/* --- Dedicated inputs for Next Dial & Assigned Agent --- */}
        <div className="space-y-4 border-t pt-6 border-slate-100">
          <Label className="text-xs text-slate-500 uppercase tracking-wider font-bold">Additional Settings</Label>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-slate-700 w-1/2">Next Dial</span>
            <Input
              type="datetime-local"
              min={new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
              value={uploadNextDialAt}
              onChange={(e) => setUploadNextDialAt(e.target.value)}
              className="flex h-10 w-1/2"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-slate-700 w-1/2">Assigned Agent</span>
            {mode === "assign" ? (
              <select
                className="flex h-10 w-1/2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 cursor-pointer"
                value={uploadAgent}
                onChange={(e) => setUploadAgent(e.target.value)}
                required
              >
                <option value="" disabled>— Select agent —</option>
                {activeAgents.map(a => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
              </select>
            ) : (
              <select
                className="flex h-10 w-1/2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 cursor-pointer"
                value={uploadAgent}
                onChange={(e) => setUploadAgent(e.target.value)}
              >
                <option value="">— None (optional) —</option>
                {activeAgents.map(a => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
              </select>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
        <AppNavbar />

        <main className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto w-full">

          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Clients Management</h1>
              <p className="text-muted-foreground mt-1">Track, analyze, and manage your customer pipeline.</p>
            </div>
          </div>

          {/* --- KPIs --- */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
            <Card className="shadow-sm border-slate-100">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-[hsl(var(--tertiary))]">Total Clients</CardTitle>
                <Users className="h-4 w-4 text-slate-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-800">{totalClientsCount}</div>
                <p className="text-xs text-muted-foreground mt-1">From server database</p>
              </CardContent>
            </Card>
            <Card className="shadow-sm border-slate-100">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-[hsl(var(--tertiary))]">Fresh Clients</CardTitle>
                <Target className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-800">
                  {freshClients}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Pending first dial</p>
              </CardContent>
            </Card>
            <Card className="shadow-sm border-slate-100">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-[hsl(var(--tertiary))]">Closed</CardTitle>
                <PhoneCall className="h-4 w-4 text-emerald-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-800">
                  {closedClients}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Successfully answered</p>
              </CardContent>
            </Card>
            <Card className="shadow-sm border-slate-100 bg-red-50/50">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-rose-600">Overdue Follow-ups</CardTitle>
                <AlertCircle className="h-4 w-4 text-rose-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-rose-700">
                  {overdueCount}
                </div>
                <p className="text-xs text-rose-600/80 mt-1">Requires immediate action</p>
              </CardContent>
            </Card>
          </div>

          {/* --- REPORTS / INSIGHTS --- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
            <Card className="shadow-sm border-slate-100">
              <CardHeader>
                <CardTitle className="text-[hsl(var(--tertiary))] text-lg">Client Status Distribution</CardTitle>
                <CardDescription>Current state of the entire pipeline.</CardDescription>
              </CardHeader>
              <CardContent>
                {/* Added h-[320px] as the default mobile height */}
                <div className="w-full flex flex-col items-center justify-center h-[350px] sm:h-[350px] md:h-[400px] lg:h-[420px]">
                  {statusDistribution.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={statusDistribution}
                          cx="50%"
                          cy="40%"
                          innerRadius={65}
                          outerRadius={95}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {statusDistribution.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip contentStyle={{ backgroundColor: "hsl(var(--background))", borderRadius: "8px", border: "1px solid hsl(var(--border))" }} />
                        <Legend
                          content={(props: any) => {
                            const { payload } = props;
                            return (
                              <div className="grid grid-cols-2 lg:grid-cols-3 gap-y-3 gap-x-8 mx-auto w-fit mt-8">
                                {payload?.map((entry: any, index: number) => (
                                  <div key={`item-${index}`} className="flex items-center w-[130px]">
                                    <span
                                      className="w-[8px] h-[8px] rounded-full shrink-0 mr-1.5 mt-[1px]"
                                      style={{ backgroundColor: entry.color }}
                                    />
                                    <span className="text-[12px] font-semibold text-slate-500 whitespace-nowrap mr-1">
                                      {entry.value}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            );
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-sm text-slate-400 italic">No status data available.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-slate-100">
              <CardHeader>
                <CardTitle className="text-[hsl(var(--tertiary))] text-lg">Clients by Project</CardTitle>
                <CardDescription>Volume distribution across active campaigns.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[320px] w-full">
                  {projectVolume.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={projectVolume} margin={{ top: 10, right: 20, left: -10, bottom: 10 }} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="rgba(226, 232, 240, 0.5)" />
                        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis dataKey="name" type="category" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} width={120} />
                        <RechartsTooltip cursor={{ fill: "rgba(148, 163, 184, 0.05)" }} contentStyle={{ backgroundColor: "hsl(var(--background))", borderRadius: "8px", border: "1px solid #e2e8f0" }} />
                        <Bar dataKey="clients" fill={chartPalette.emerald} radius={[0, 4, 4, 0]} barSize={28}>
                           <LabelList dataKey="clients" position="right" style={{ fontSize: 11, fontWeight: 700, fill: "#334155" }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center">
                      <p className="text-sm text-slate-400 italic">No project data available.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* --- CLIENTS TABLE --- */}
          <Card className="shadow-sm border-slate-100 flex flex-col">
            <CardHeader className="flex flex-col gap-5 pb-6">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 w-full">
                <div>
                  <CardTitle className="text-[hsl(var(--tertiary))] text-xl">Clients Directory</CardTitle>
                  <CardDescription>Manage your clients and view their individual details.</CardDescription>
                </div>
                <div className="w-full md:w-auto flex justify-end">
                  <div className="relative w-full md:w-[250px]">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      placeholder="Search by name or number"
                      className="pl-9 h-9 w-full"
                      value={searchTerm}
                      onChange={(e) => { setSearchTerm(e.target.value); }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 w-full border-t pt-4 border-slate-100">
                <div className="flex items-center gap-3 w-full md:w-auto flex-wrap">
                  <Filter className="h-4 w-4 text-slate-400 hidden sm:block" />

                  {/* Client Type Filter */}
                  <div className="flex items-center rounded-md border border-input bg-background overflow-hidden h-9 shrink-0">
                    {(["", "OWNER", "LEAD"] as const).map((t) => (
                      <button
                        key={t || "all"}
                        type="button"
                        onClick={() => { setTypeFilter(t); setCurrentPage(1); }}
                        className={`px-3 h-full text-sm font-medium transition-colors ${
                          typeFilter === t
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-slate-100 text-slate-600"
                        }`}
                      >
                        {t === "" ? "All Types" : t === "OWNER" ? "Owners" : "Leads"}
                      </button>
                    ))}
                  </div>

                  {/* Call Status Filter */}
                  <select
                    className="h-9 w-full sm:w-auto rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none"
                    value={statusFilter}
                    onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
                  >
                    <option value="All">All Statuses</option>
                    <option value="Dial">Dial</option>
                    <option value="Callback">Callback</option>
                    <option value="Answered">Answered</option>
                    <option value="No Answer">No Answer</option>
                    <option value="Not Interested">Not Interested</option>
                    <option value="Busy">Busy</option>
                    <option value="Failed">Failed</option>
                  </select>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto justify-end">
                  <Button onClick={exportToCSV} variant="default" className="h-9 w-full sm:w-auto">
                    <Download className="h-4 w-4"/> Export CSV
                  </Button>
                  <Button onClick={() => setIsUploadOpen(true)} className="h-9 w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white">
                    <UploadCloud className="h-4 w-4" /> Upload Clients
                  </Button>
                  <Button onClick={() => setIsAssignOpen(true)} className="h-9 w-full sm:w-auto bg-emerald-500 hover:bg-emerald-600 text-white border-none transition-colors justify-center">
                    <Users className="h-4 w-4" /> Assign Clients
                  </Button>
                </div>
              </div>
            </CardHeader>


            <CardContent className="p-0">
              <div className="block w-full overflow-x-auto">
                <Table className="min-w-[1000px] w-full">
                  <TableHeader>
                    <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                      <TableHead className="pl-6">Client Name</TableHead>
                      <TableHead>Primary Phone</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-center">Attempts</TableHead>
                      <TableHead>Next Dial</TableHead>
                      <TableHead className="pr-6 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center text-slate-500">
                          <div className="flex items-center justify-center gap-2">
                            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                            Loading clients...
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : paginatedClients.length > 0 ? paginatedClients.map(client => (
                      <TableRow key={client.id} className="hover:bg-slate-50/80 transition-colors">
                        <TableCell className="pl-6 font-semibold text-slate-800 whitespace-nowrap">{client.name}</TableCell>
                        <TableCell className="font-mono text-xs text-slate-600 whitespace-nowrap">{client.primaryNumber}</TableCell>
                        <TableCell className="text-xs text-slate-600 font-medium whitespace-nowrap">{client.projects.join(', ') || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge variant="outline" className={`font-semibold border-none ${getStatusColor(client.status)}`}>
                            {client.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center font-semibold text-slate-700">{client.attemptCount}</TableCell>
                        <TableCell className="text-sm text-slate-600 whitespace-nowrap">{client.nextDialAt ? new Date(client.nextDialAt).toLocaleString() : "—"}</TableCell>
                        <TableCell className="pr-6 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0">
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-background">
                              <DropdownMenuItem className="cursor-pointer focus:bg-slate-200" onClick={() => {
                                setSelectedClient(client)
                                loadClientHistory(client.id)
                              }}>
                                <Search className="h-4 w-4 mr-2 text-slate-500" /> View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem className="cursor-pointer focus:bg-slate-200" onClick={() => openEditClient(client)}>
                                <Edit className="h-4 w-4 mr-2 text-blue-500" /> Edit Client
                              </DropdownMenuItem>
                              <DropdownMenuItem className="cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => setDeletingClientId(client.id)}>
                                <Trash2 className="h-4 w-4 mr-2 text-red-500" /> Delete Client
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center text-slate-500">
                          No clients found matching your search.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>

            {/* Pagination */}
            <CardFooter className="flex flex-col-reverse sm:flex-row items-center justify-between gap-4 border-t border-slate-100 p-4 sm:p-6">
              <div className="text-sm text-muted-foreground text-center sm:text-left w-full sm:w-auto">
                Showing <strong>{totalClients === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1}</strong> to <strong>{Math.min(currentPage * ITEMS_PER_PAGE, totalClients)}</strong> of <strong>{totalClients}</strong> clients
              </div>
              <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
                <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Previous</span>
                </Button>
                <div className="flex items-center px-2 text-sm font-medium text-slate-600 whitespace-nowrap">
                  Page {currentPage} of {totalPages}
                </div>
                <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>
                  <span className="hidden sm:inline">Next</span>
                  <ChevronRight className="h-4 w-4 sm:ml-1" />
                </Button>
              </div>
            </CardFooter>
          </Card>
        </main>
      </div>

      {/* --- EDIT CLIENT DIALOG --- */}
      <Dialog open={editingClient !== null} onOpenChange={(open) => !open && setEditingClient(null)}>
        <DialogContent className="sm:max-w-[450px] bg-background">
          <DialogHeader>
            <DialogTitle>Edit Client Details</DialogTitle>
            <DialogDescription>Make changes to the client profile here. Click save when you're done.</DialogDescription>
          </DialogHeader>

          {editingClient && (
            <form onSubmit={handleUpdateClient}>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="col-span-2 flex flex-col gap-2">
                  <Label>Client Name</Label>
                  <Input
                    value={editingClient.name}
                    onChange={(e) => setEditingClient({...editingClient, name: e.target.value})}
                    required
                  />
                </div>

                <div className="col-span-2 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label>Phone Numbers</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addEditingPhone} className="h-7 px-2 text-xs flex items-center gap-1 text-emerald-600 border-emerald-200 hover:bg-emerald-50">
                      <Plus className="h-3.5 w-3.5" /> Add Number
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {editingPhones.map((phone, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input
                          value={phone}
                          onChange={(e) => updateEditingPhone(index, e.target.value)}
                          placeholder={`Phone ${index + 1}`}
                          className={index === 0 ? "flex-1" : "flex-1 bg-slate-50"}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                          onClick={() => removeEditingPhone(index)}
                          disabled={editingPhones.length === 1}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">You can add or remove multiple phone numbers for this client.</p>
                </div>

                <div className="col-span-2 flex flex-col gap-2">
                  <Label>Project / Campaign</Label>
                  <Input
                    value={editingClient.projects.join(', ')}
                    disabled
                    className="bg-slate-50"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label>Client Type</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                    value={editingClient._raw.type || "OWNER"}
                    onChange={(e) => setEditingClient({...editingClient, _raw: { ...editingClient._raw, type: e.target.value }})}
                  >
                    <option value="OWNER">Owner</option>
                    <option value="LEAD">Lead</option>
                    <option value="BOTH">Both</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>Next Dial</Label>
                  <Input
                    type="datetime-local"
                    min={new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                    value={editingClient.nextDialAt ? editingClient.nextDialAt.slice(0, 16) : ""}
                    onChange={(e) => setEditingClient({...editingClient, nextDialAt: e.target.value ? new Date(e.target.value).toISOString() : null})}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingClient(null)}>Cancel</Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white">Save Changes</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* --- DELETE CLIENT CONFIRMATION DIALOG --- */}
      <Dialog open={deletingClientId !== null} onOpenChange={(open) => !open && setDeletingClientId(null)}>
        <DialogContent className="sm:max-w-[425px] bg-background border-red-100">
          <DialogHeader>
            <DialogTitle className="text-red-600">Delete Client</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete this client? This action will remove all associated call history and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => setDeletingClientId(null)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={handleDeleteClient}>Yes, Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- UPLOAD CLIENTS DIALOG --- */}
      <Dialog open={isUploadOpen} onOpenChange={(open) => !open && resetModals()}>
        <DialogContent className="sm:max-w-[550px] min-h-[500px] max-h-[90vh] overflow-y-auto bg-background">
          <DialogHeader>
            <DialogTitle>Upload Clients File</DialogTitle>
            <DialogDescription>
              {uploadStep === 1 ? "Add new clients to the database via CSV file." : "Map the columns in your file to the system's required fields."}
            </DialogDescription>
          </DialogHeader>

          {uploadStep === 1 ? (
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>File Upload</Label>
                <div className="border-2 border-dashed border-slate-200 rounded-lg p-10 flex flex-col items-center justify-center bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer relative">
                  <input
                    type="file"
                    accept=".csv, .xlsx, .xls"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={handleFileSelect}
                  />
                  <FileSpreadsheet className={`h-12 w-12 mb-4 ${uploadFile ? 'text-blue-500' : 'text-slate-400'}`} />
                  <span className="text-base font-semibold text-slate-700 text-center">
                    {uploadFile ? uploadFile.name : "Click or drag file to upload"}
                  </span>
                  <span className="text-sm text-slate-500 mt-2">.CSV or .XLSX (up to 10MB)</span>
                </div>
              </div>
              <DialogFooter className="pt-6">
                <Button type="button" variant="outline" onClick={resetModals}>Cancel</Button>
                <Button type="button" disabled={!uploadFile} onClick={handleGoToMapping} className="bg-blue-600 hover:bg-blue-700 text-white">
                  Next: Map Columns <ArrowRight className="ml-2 h-4 w-4"/>
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={(e) => handleFinalSubmit(e, "upload")}>
              {renderMappingUI("upload")}
              <DialogFooter className="pt-8">
                <Button type="button" variant="ghost" onClick={() => setUploadStep(1)}>Back</Button>
                <Button
                  type="submit"
                  disabled={!columnMapping["Primary Phone"]}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <CheckCircle2 className="mr-2 h-4 w-4"/> Complete Upload
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* --- ASSIGN CLIENTS DIALOG --- */}
      <Dialog open={isAssignOpen} onOpenChange={(open) => !open && resetModals()}>
        <DialogContent className="sm:max-w-[550px] min-h-[500px] max-h-[90vh] overflow-y-auto bg-background">
          <DialogHeader>
            <DialogTitle>Assign Clients to Agent</DialogTitle>
            <DialogDescription>
              {uploadStep === 1 ? "Upload an assignment file to map specific clients to an agent." : "Map the columns and assign the parsed clients to a specific agent."}
            </DialogDescription>
          </DialogHeader>

          {uploadStep === 1 ? (
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>File Upload</Label>
                <div className="border-2 border-dashed border-slate-200 rounded-lg p-10 flex flex-col items-center justify-center bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer relative">
                  <input
                    type="file"
                    accept=".csv, .xlsx, .xls"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={handleFileSelect}
                  />
                  <FileSpreadsheet className={`h-12 w-12 mb-4 ${uploadFile ? 'text-emerald-500' : 'text-slate-400'}`} />
                  <span className="text-base font-semibold text-slate-700 text-center">
                    {uploadFile ? uploadFile.name : "Click or drag file to upload"}
                  </span>
                  <span className="text-sm text-slate-500 mt-2">.CSV or .XLSX (up to 10MB)</span>
                </div>
              </div>
              <DialogFooter className="pt-6">
                <Button type="button" variant="outline" onClick={resetModals}>Cancel</Button>
                <Button type="button" disabled={!uploadFile} onClick={handleGoToMapping} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  Next: Map Columns <ArrowRight className="ml-2 h-4 w-4"/>
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={(e) => handleFinalSubmit(e, "assign")}>
              {renderMappingUI("assign")}

              <DialogFooter className="pt-8">
                <Button type="button" variant="ghost" onClick={() => setUploadStep(1)}>Back</Button>
                <Button
                  type="submit"
                  disabled={!uploadAgent || !columnMapping["Primary Phone"]}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <CheckCircle2 className="mr-2 h-4 w-4"/> Import & Assign
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* --- CLIENT DETAILS DIALOG --- */}
      <Dialog open={selectedClient !== null} onOpenChange={(open) => !open && setSelectedClient(null)}>
        <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto bg-background">
          {selectedClient && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between pr-6">
                  <DialogTitle className="text-xl">{selectedClient.name}</DialogTitle>
                  <Badge variant="outline" className={`border-none ${getStatusColor(selectedClient.status)}`}>{selectedClient.status}</Badge>
                </div>
                <DialogDescription className="font-mono text-sm">{selectedClient.primaryNumber}</DialogDescription>
              </DialogHeader>

              <div className="space-y-6 py-4">
                {/* Meta Grid */}
                <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Client Type</p>
                    <p className="text-sm font-medium text-slate-800">{selectedClient._raw.type || "OWNER"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Projects</p>
                    <p className="text-sm font-medium text-slate-800">{selectedClient.projects.join(", ") || "None"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Total Attempts</p>
                    <p className="text-sm font-medium text-slate-800">{selectedClient.attemptCount}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Next Scheduled Dial</p>
                    <p className="text-sm font-medium text-slate-800">{selectedClient.nextDialAt ? new Date(selectedClient.nextDialAt).toLocaleString() : "None"}</p>
                  </div>
                </div>

                {/* All Phone Numbers */}
                {selectedClient._raw.phones && selectedClient._raw.phones.length > 1 && (
                  <div>
                    <h4 className="text-sm font-bold text-slate-800 mb-2 border-b pb-1">Phone Numbers</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedClient._raw.phones.map((p, i) => (
                        <span key={i} className="font-mono text-sm bg-slate-100 px-3 py-1 rounded-md">{p.phone}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Owner Info (Dynamic KV Pairs) */}
                {selectedClient.info.length > 0 && (
                  <div>
                    <h4 className="text-sm font-bold text-slate-800 mb-2 border-b pb-1">Client Attributes</h4>
                    <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                      {selectedClient.info.map((info, i) => (
                        <div key={i} className="flex flex-col">
                          <span className="text-xs text-slate-500">{info.key}</span>
                          <span className="text-sm font-medium text-slate-800">{info.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Call History */}
                <div>
                  <h4 className="text-sm font-bold text-slate-800 mb-2 border-b pb-1">Call History</h4>
                  {isLoadingHistory ? (
                    <div className="flex items-center gap-2 py-4 justify-center text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading call history...
                    </div>
                  ) : selectedClientHistory.length > 0 ? (
                    <div className="space-y-3">
                      {selectedClientHistory.map((record) => (
                        <div key={record.id} className="flex flex-col p-3 border border-slate-100 rounded-lg shadow-sm">
                          <div className="flex justify-between items-start mb-1">
                            <span className="text-xs font-bold text-slate-700">{new Date(record.time).toLocaleString()}</span>
                            <Badge variant="outline" className={`text-[10px] py-0 h-4 border-none ${getStatusColor(record.status)}`}>{formatStatus(record.status)}</Badge>
                          </div>
                          <p className="text-xs text-slate-500 mb-1">
                            Agent ID: {record.agent_id} • Duration: {record.duration || 0}s
                            {record.projects && record.projects.length > 0 && ` • ${record.projects.map(p => p.name).join(', ')}`}
                          </p>
                          {record.agent_notes && (
                            <p className="text-sm text-slate-800 italic">"{record.agent_notes}"</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 italic">No call history recorded yet.</p>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedClient(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Toaster position="bottom-right" richColors />
    </>
  )
}