
const SUPABASE_URL = "https://mfuijgzytzfgigepaocz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_BSsA8_YGwXByhgc0_A4YyA_7QPMvELF";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const $ = id => document.getElementById(id);
let cashflowChart = null;
let expenseChart = null;
let currentProfile = null;
let currentSession = null;

let incomeInstitutions = [];
let incomeAccounts = [];
let incomeFundSources = [];
let incomeRowsCache = [];
let pendingIncomeSaveAction = "draft";

let expenseInstitutions = [];
let expenseAccounts = [];
let expenseCategories = [];
let expenseRowsCache = [];
let pendingExpenseSaveAction = "draft";

const rupiah = n => new Intl.NumberFormat("id-ID",{
  style:"currency",currency:"IDR",maximumFractionDigits:0
}).format(Number(n||0));

const shortMoney = n => {
  n = Number(n||0);
  if (Math.abs(n)>=1e9) return "Rp"+(n/1e9).toFixed(1)+" M";
  if (Math.abs(n)>=1e6) return "Rp"+(n/1e6).toFixed(1)+" jt";
  if (Math.abs(n)>=1e3) return "Rp"+(n/1e3).toFixed(0)+" rb";
  return rupiah(n);
};

const escapeHtml = s => String(s??"")
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#039;");

function toast(msg){
  const t=$("toast"); t.textContent=msg; t.classList.add("show");
  clearTimeout(window.__toast); window.__toast=setTimeout(()=>t.classList.remove("show"),2800);
}

function roleLabel(r){
  return {SUPER_ADMIN:"Super Admin Yayasan",FOUNDATION_TREASURER:"Bendahara Yayasan",
    INSTITUTION_ADMIN:"Admin/Bendahara Lembaga",VIEWER:"Viewer"}[r]||r||"-";
}
function typeLabel(t){return {INCOME:"Pemasukan",EXPENSE:"Pengeluaran",TRANSFER:"Transfer"}[t]||t}
function typeClass(t){return {INCOME:"income",EXPENSE:"expense",TRANSFER:"transfer"}[t]||""}
function statusClass(s){
  return {APPROVED:"approved",SUBMITTED:"submitted",DRAFT:"draft",REJECTED:"rejected",VOID:"draft"}[s]||"draft"
}
function formatDate(v){
  if(!v)return "-";
  return new Intl.DateTimeFormat("id-ID",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(v+"T00:00:00"));
}
function monthRange(){
  const d=new Date(), y=d.getFullYear(), m=d.getMonth();
  const start=new Date(y,m,1).toISOString().slice(0,10);
  const next=new Date(y,m+1,1).toISOString().slice(0,10);
  return {start,next};
}
function isCentralUser(){
  return ["SUPER_ADMIN","FOUNDATION_TREASURER"].includes(currentProfile?.role);
}
function todayISO(){
  const d=new Date();
  const tz=d.getTimezoneOffset();
  return new Date(d.getTime()-tz*60000).toISOString().slice(0,10);
}

async function getProfile(uid){
  const {data,error}=await sb.from("profiles")
    .select("id,full_name,role,institution_id,institutions:institution_id(id,name,code,institution_type)")
    .eq("id",uid).single();
  if(error) throw error;
  return data;
}

async function enterApp(session){
  try{
    currentSession=session;
    currentProfile=await getProfile(session.user.id);
    const p=currentProfile;

    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");

    const first=(p.full_name||"Pengguna").trim().split(/\s+/)[0];
    $("userName").textContent=p.full_name||"Pengguna";
    $("userRole").textContent=roleLabel(p.role);
    $("avatar").textContent=first.charAt(0).toUpperCase();
    $("welcomeName").textContent=first;
    $("welcomeInstitution").textContent=
      isCentralUser()
      ? "Dashboard konsolidasi Yayasan dan seluruh lembaga"
      : "Lembaga: "+(p.institutions?.name||"-");
    $("today").textContent=new Intl.DateTimeFormat("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date());

    await loadDashboard();
  }catch(err){
    console.error(err);
    await sb.auth.signOut();
    currentProfile=null; currentSession=null;
    $("appView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
    $("loginError").textContent="Login berhasil, tetapi profil SIMKEU tidak ditemukan. Periksa tabel profiles.";
    $("loginError").classList.remove("hidden");
  }
}

async function loadDashboard(){
  $("refreshBtn").disabled=true;
  try{
    const r=monthRange(), y=new Date().getFullYear();
    const [balances,monthly,pending,recent,yearly]=await Promise.all([
      sb.from("v_account_balances").select("account_id,institution_id,institution_name,account_name,current_balance"),
      sb.from("transactions").select("id,transaction_type,amount,expense_category_id,status,transaction_date,expense_categories:expense_category_id(name)")
        .eq("status","APPROVED").gte("transaction_date",r.start).lt("transaction_date",r.next),
      sb.from("transactions").select("id",{count:"exact",head:true}).eq("status","SUBMITTED"),
      sb.from("transactions").select("id,transaction_number,transaction_date,transaction_type,amount,status,institutions:institution_id(name)")
        .order("transaction_date",{ascending:false}).order("created_at",{ascending:false}).limit(8),
      sb.from("transactions").select("transaction_date,transaction_type,amount,status").eq("status","APPROVED")
        .gte("transaction_date",`${y}-01-01`).lt("transaction_date",`${y+1}-01-01`)
    ]);
    [balances,monthly,pending,recent,yearly].forEach(x=>{if(x.error)throw x.error});
    const b=balances.data||[], m=monthly.data||[];
    $("totalBalance").textContent=rupiah(b.reduce((s,x)=>s+Number(x.current_balance||0),0));
    $("monthlyIncome").textContent=rupiah(m.filter(x=>x.transaction_type==="INCOME").reduce((s,x)=>s+Number(x.amount||0),0));
    $("monthlyExpense").textContent=rupiah(m.filter(x=>x.transaction_type==="EXPENSE").reduce((s,x)=>s+Number(x.amount||0),0));
    $("pendingCount").textContent=pending.count||0;
    renderInstitutions(b);
    renderRecent(recent.data||[]);
    renderCashflow(yearly.data||[]);
    renderExpense(m);
  }catch(err){
    console.error(err);
    toast("Gagal memuat dashboard: "+(err.message||"error"));
  }finally{$("refreshBtn").disabled=false}
}

function renderInstitutions(rows){
  const map=new Map();
  rows.forEach(r=>{
    const n=r.institution_name||"Lembaga";
    if(!map.has(n))map.set(n,{total:0,count:0});
    map.get(n).total+=Number(r.current_balance||0);
    map.get(n).count++;
  });
  $("institutionBalances").innerHTML=map.size?[...map.entries()].map(([n,v])=>`
    <div class="institution-row">
      <div class="institution-name">
        <div class="badge">${escapeHtml(n.slice(0,3).toUpperCase())}</div>
        <div><strong>${escapeHtml(n)}</strong><span>${v.count} akun kas/bank</span></div>
      </div>
      <div class="institution-amount">${rupiah(v.total)}</div>
    </div>`).join(""):`<div class="empty">Belum ada akun kas/bank.</div>`;
}

function renderRecent(rows){
  $("recentTransactions").innerHTML=rows.length?rows.map(t=>`
    <tr>
      <td>${formatDate(t.transaction_date)}</td>
      <td><strong>${escapeHtml(t.transaction_number||"-")}</strong></td>
      <td><span class="pill ${typeClass(t.transaction_type)}">${typeLabel(t.transaction_type)}</span></td>
      <td>${escapeHtml(t.institutions?.name||"-")}</td>
      <td><strong>${rupiah(t.amount)}</strong></td>
      <td><span class="pill ${statusClass(t.status)}">${escapeHtml(t.status)}</span></td>
    </tr>`).join(""):`<tr><td colspan="6" class="empty">Belum ada transaksi.</td></tr>`;
}

function renderCashflow(rows){
  const inc=Array(12).fill(0), exp=Array(12).fill(0);
  rows.forEach(t=>{
    const m=new Date(t.transaction_date+"T00:00:00").getMonth();
    if(t.transaction_type==="INCOME")inc[m]+=Number(t.amount||0);
    if(t.transaction_type==="EXPENSE")exp[m]+=Number(t.amount||0);
  });
  if(cashflowChart)cashflowChart.destroy();
  cashflowChart=new Chart($("cashflowChart"),{
    type:"line",
    data:{labels:["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"],
      datasets:[
        {label:"Pemasukan",data:inc,borderColor:"#F89921",backgroundColor:"rgba(248,153,33,.10)",fill:true,tension:.35,borderWidth:2,pointRadius:2},
        {label:"Pengeluaran",data:exp,borderColor:"#8C3F20",backgroundColor:"rgba(140,63,32,.03)",fill:false,tension:.35,borderWidth:2,pointRadius:2}
      ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"top",align:"end"},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${rupiah(c.raw)}`}}},
      scales:{x:{grid:{display:false}},y:{beginAtZero:true,ticks:{callback:v=>shortMoney(v)},grid:{color:"#F0ECE7"}}}}
  });
}

function renderExpense(rows){
  const map=new Map();
  rows.filter(x=>x.transaction_type==="EXPENSE").forEach(x=>{
    const n=x.expense_categories?.name||"Lainnya";
    map.set(n,(map.get(n)||0)+Number(x.amount||0));
  });
  let labels=[...map.keys()], data=[...map.values()];
  const empty=!data.length;
  if(empty){labels=["Belum ada pengeluaran"];data=[1]}
  if(expenseChart)expenseChart.destroy();
  expenseChart=new Chart($("expenseChart"),{
    type:"doughnut",
    data:{labels,datasets:[{data,backgroundColor:empty?["#E7E3DE"]:["#F89921","#CD6828","#2D2A27","#E9B44C","#8C3F20","#F2C078","#6B5A49","#C97A40","#A69A8B"],borderWidth:0}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:"67%",plugins:{legend:{position:"bottom",labels:{usePointStyle:true,boxWidth:8,font:{size:10}}},tooltip:{callbacks:{label:c=>empty?"Belum ada data":`${c.label}: ${rupiah(c.raw)}`}}}}
  });
}

/* =========================================================
   MODUL PEMASUKAN
   ========================================================= */

async function loadIncomeModule(){
  try{
    $("incomeTransactionsBody").innerHTML=`<tr><td colspan="8" class="empty">Memuat...</td></tr>`;

    const [instRes, accountRes, fundRes] = await Promise.all([
      sb.from("institutions").select("id,code,name,institution_type").eq("is_active",true).order("name"),
      sb.from("accounts").select("id,institution_id,account_name,account_type,bank_name,is_active").eq("is_active",true).order("account_name"),
      sb.from("fund_sources").select("id,code,name,is_active").eq("is_active",true).order("name")
    ]);
    [instRes,accountRes,fundRes].forEach(r=>{if(r.error)throw r.error});

    incomeInstitutions=instRes.data||[];
    incomeAccounts=accountRes.data||[];
    incomeFundSources=fundRes.data||[];

    fillIncomeMasterOptions();
    if(!$("incomeDate").value) $("incomeDate").value=todayISO();

    await loadIncomeTransactions();
  }catch(err){
    console.error(err);
    toast("Gagal memuat modul pemasukan: "+(err.message||"error"));
  }
}

function fillIncomeMasterOptions(){
  const instSelect=$("incomeInstitution");
  const fundSelect=$("incomeFundSource");

  instSelect.innerHTML=`<option value="">Pilih lembaga</option>`+
    incomeInstitutions.map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("");

  fundSelect.innerHTML=`<option value="">Pilih sumber dana</option>`+
    incomeFundSources.map(f=>`<option value="${f.id}">${escapeHtml(f.name)}</option>`).join("");

  if(!isCentralUser() && currentProfile?.institution_id){
    instSelect.value=currentProfile.institution_id;
    instSelect.disabled=true;
    refreshIncomeAccountOptions();
  }else{
    instSelect.disabled=false;
  }
}

function refreshIncomeAccountOptions(){
  const institutionId=$("incomeInstitution").value;
  const accountSelect=$("incomeDestinationAccount");
  const rows=incomeAccounts.filter(a=>a.institution_id===institutionId);

  accountSelect.innerHTML=`<option value="">Pilih akun kas/bank</option>`+
    rows.map(a=>`<option value="${a.id}">${escapeHtml(a.account_name)}${a.bank_name&&a.bank_name!=="Belum Diisi" ? " — "+escapeHtml(a.bank_name) : ""}</option>`).join("");

  accountSelect.disabled=!institutionId || !rows.length;
}

async function loadIncomeTransactions(){
  const {data,error}=await sb.from("transactions")
    .select(`
      id,
      transaction_number,
      transaction_date,
      amount,
      description,
      status,
      created_at,
      institution_id,
      destination_account_id,
      fund_source_id,
      institutions:institution_id(name),
      fund_sources:fund_source_id(name),
      accounts:destination_account_id(account_name,account_type,bank_name)
    `)
    .eq("transaction_type","INCOME")
    .order("transaction_date",{ascending:false})
    .order("created_at",{ascending:false})
    .limit(150);

  if(error) throw error;
  incomeRowsCache=data||[];
  updateIncomeModuleStats();
  renderIncomeRows();
}

function updateIncomeModuleStats(){
  const r=monthRange();
  const approvedMonth=incomeRowsCache
    .filter(x=>x.status==="APPROVED" && x.transaction_date>=r.start && x.transaction_date<r.next)
    .reduce((s,x)=>s+Number(x.amount||0),0);

  $("incomeModuleApproved").textContent=rupiah(approvedMonth);
  $("incomeDraftCount").textContent=incomeRowsCache.filter(x=>x.status==="DRAFT").length;
  $("incomeSubmittedCount").textContent=incomeRowsCache.filter(x=>x.status==="SUBMITTED").length;
}

function renderIncomeRows(){
  const term=($("incomeSearch").value||"").trim().toLowerCase();
  const status=$("incomeStatusFilter").value;

  const rows=incomeRowsCache.filter(x=>{
    const hay=[
      x.transaction_number,
      x.description,
      x.institutions?.name,
      x.fund_sources?.name,
      x.accounts?.account_name
    ].filter(Boolean).join(" ").toLowerCase();
    return (!term || hay.includes(term)) && (status==="ALL" || x.status===status);
  });

  $("incomeTransactionsBody").innerHTML=rows.length?rows.map(row=>{
    const actions=[];
    if(row.status==="DRAFT"){
      actions.push(`<button class="table-action primary" data-income-action="submit" data-id="${row.id}">Ajukan</button>`);
    }
    if(row.status==="SUBMITTED" && isCentralUser()){
      actions.push(`<button class="table-action approve" data-income-action="approve" data-id="${row.id}">Setujui</button>`);
      actions.push(`<button class="table-action reject" data-income-action="reject" data-id="${row.id}">Tolak</button>`);
    }

    return `
      <tr>
        <td>${formatDate(row.transaction_date)}</td>
        <td><strong>${escapeHtml(row.transaction_number||"-")}</strong><span class="account-sub description-cell" title="${escapeHtml(row.description||"")}">${escapeHtml(row.description||"")}</span></td>
        <td>${escapeHtml(row.institutions?.name||"-")}</td>
        <td>${escapeHtml(row.fund_sources?.name||"-")}</td>
        <td>${escapeHtml(row.accounts?.account_name||"-")}</td>
        <td><strong>${rupiah(row.amount)}</strong></td>
        <td><span class="pill ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
        <td><div class="action-group">${actions.join("") || `<span class="account-sub">—</span>`}</div></td>
      </tr>`;
  }).join(""):`<tr><td colspan="8" class="empty">Belum ada data pemasukan sesuai filter.</td></tr>`;
}

function resetIncomeForm(){
  $("incomeForm").reset();
  $("incomeDate").value=todayISO();
  $("incomeAmountPreview").textContent="Rp0";
  if(!isCentralUser() && currentProfile?.institution_id){
    $("incomeInstitution").value=currentProfile.institution_id;
    $("incomeInstitution").disabled=true;
    refreshIncomeAccountOptions();
  }else{
    $("incomeInstitution").disabled=false;
    $("incomeDestinationAccount").innerHTML=`<option value="">Pilih akun kas/bank</option>`;
    $("incomeDestinationAccount").disabled=true;
  }
}

async function saveIncome(action){
  if(!currentSession?.user?.id) throw new Error("Sesi login tidak ditemukan.");

  const institution_id=$("incomeInstitution").value;
  const fund_source_id=$("incomeFundSource").value;
  const destination_account_id=$("incomeDestinationAccount").value;
  const transaction_date=$("incomeDate").value;
  const amount=Number($("incomeAmount").value);
  const description=($("incomeDescription").value||"").trim();

  if(!transaction_date||!institution_id||!fund_source_id||!destination_account_id||!amount||amount<=0){
    throw new Error("Lengkapi tanggal, lembaga, sumber dana, akun tujuan, dan nominal.");
  }

  const selectedAccount=incomeAccounts.find(a=>a.id===destination_account_id);
  if(!selectedAccount || selectedAccount.institution_id!==institution_id){
    throw new Error("Akun tujuan tidak sesuai dengan lembaga yang dipilih.");
  }

  const payload={
    transaction_type:"INCOME",
    transaction_date,
    institution_id,
    fund_source_id,
    destination_account_id,
    source_account_id:null,
    expense_category_id:null,
    amount,
    description:description||null,
    status:"DRAFT",
    created_by:currentSession.user.id
  };

  const {data,error}=await sb.from("transactions").insert(payload).select("id,transaction_number").single();
  if(error) throw error;

  if(action==="submit"){
    const {error:submitError}=await sb.rpc("submit_transaction",{p_transaction_id:data.id});
    if(submitError) throw submitError;
  }

  resetIncomeForm();
  await Promise.all([loadIncomeTransactions(),loadDashboard()]);
  toast(action==="submit" ? `Pemasukan ${data.transaction_number} berhasil diajukan.` : `Pemasukan ${data.transaction_number} disimpan sebagai Draft.`);
}

async function submitExistingIncome(id){
  const {error}=await sb.rpc("submit_transaction",{p_transaction_id:id});
  if(error) throw error;
  await Promise.all([loadIncomeTransactions(),loadDashboard()]);
  toast("Transaksi berhasil diajukan untuk approval.");
}

async function approveIncome(id){
  if(!confirm("Setujui transaksi pemasukan ini? Setelah APPROVED, transaksi akan memengaruhi saldo.")) return;
  const {error}=await sb.rpc("approve_transaction",{p_transaction_id:id,p_note:"Disetujui melalui SIMKEU"});
  if(error) throw error;
  await Promise.all([loadIncomeTransactions(),loadDashboard()]);
  toast("Pemasukan disetujui. Saldo sudah diperbarui.");
}

async function rejectIncome(id){
  const note=prompt("Masukkan alasan penolakan:");
  if(note===null) return;
  if(!note.trim()){toast("Alasan penolakan wajib diisi.");return}
  const {error}=await sb.rpc("reject_transaction",{p_transaction_id:id,p_note:note.trim()});
  if(error) throw error;
  await Promise.all([loadIncomeTransactions(),loadDashboard()]);
  toast("Transaksi pemasukan ditolak.");
}


/* =========================================================
   MODUL PENGELUARAN + BUKTI TRANSAKSI
   ========================================================= */

async function loadExpenseModule(){
  try{
    $("expenseTransactionsBody").innerHTML=`<tr><td colspan="9" class="empty">Memuat...</td></tr>`;

    const [instRes, accountRes, catRes] = await Promise.all([
      sb.from("institutions").select("id,code,name,institution_type").eq("is_active",true).order("name"),
      sb.from("accounts").select("id,institution_id,account_name,account_type,bank_name,is_active").eq("is_active",true).order("account_name"),
      sb.from("expense_categories").select("id,code,name,is_active").eq("is_active",true).order("name")
    ]);
    [instRes,accountRes,catRes].forEach(r=>{if(r.error)throw r.error});

    expenseInstitutions=instRes.data||[];
    expenseAccounts=accountRes.data||[];
    expenseCategories=catRes.data||[];

    fillExpenseMasterOptions();
    if(!$("expenseDate").value) $("expenseDate").value=todayISO();

    await loadExpenseTransactions();
  }catch(err){
    console.error(err);
    toast("Gagal memuat modul pengeluaran: "+(err.message||"error"));
  }
}

function fillExpenseMasterOptions(){
  const instSelect=$("expenseInstitution");
  const catSelect=$("expenseCategory");

  instSelect.innerHTML=`<option value="">Pilih lembaga</option>`+
    expenseInstitutions.map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("");

  catSelect.innerHTML=`<option value="">Pilih kategori</option>`+
    expenseCategories.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");

  if(!isCentralUser() && currentProfile?.institution_id){
    instSelect.value=currentProfile.institution_id;
    instSelect.disabled=true;
    refreshExpenseAccountOptions();
  }else{
    instSelect.disabled=false;
  }
}

function refreshExpenseAccountOptions(){
  const institutionId=$("expenseInstitution").value;
  const accountSelect=$("expenseSourceAccount");
  const rows=expenseAccounts.filter(a=>a.institution_id===institutionId);

  accountSelect.innerHTML=`<option value="">Pilih kas/bank sumber</option>`+
    rows.map(a=>`<option value="${a.id}">${escapeHtml(a.account_name)}${a.bank_name&&a.bank_name!=="Belum Diisi" ? " — "+escapeHtml(a.bank_name) : ""}</option>`).join("");

  accountSelect.disabled=!institutionId || !rows.length;
}

async function loadExpenseTransactions(){
  const {data,error}=await sb.from("transactions")
    .select(`
      id,
      transaction_number,
      transaction_date,
      amount,
      description,
      status,
      created_at,
      institution_id,
      source_account_id,
      expense_category_id,
      institutions:institution_id(name),
      expense_categories:expense_category_id(name),
      accounts:source_account_id(account_name,account_type,bank_name),
      transaction_attachments(id,file_name,file_path,file_type,uploaded_at)
    `)
    .eq("transaction_type","EXPENSE")
    .order("transaction_date",{ascending:false})
    .order("created_at",{ascending:false})
    .limit(150);

  if(error) throw error;
  expenseRowsCache=data||[];
  updateExpenseModuleStats();
  renderExpenseRows();
}

function updateExpenseModuleStats(){
  const r=monthRange();
  const approvedMonth=expenseRowsCache
    .filter(x=>x.status==="APPROVED" && x.transaction_date>=r.start && x.transaction_date<r.next)
    .reduce((s,x)=>s+Number(x.amount||0),0);

  $("expenseModuleApproved").textContent=rupiah(approvedMonth);
  $("expenseDraftCount").textContent=expenseRowsCache.filter(x=>x.status==="DRAFT").length;
  $("expenseSubmittedCount").textContent=expenseRowsCache.filter(x=>x.status==="SUBMITTED").length;
}

function renderExpenseRows(){
  const term=($("expenseSearch").value||"").trim().toLowerCase();
  const status=$("expenseStatusFilter").value;

  const rows=expenseRowsCache.filter(x=>{
    const hay=[
      x.transaction_number,
      x.description,
      x.institutions?.name,
      x.expense_categories?.name,
      x.accounts?.account_name
    ].filter(Boolean).join(" ").toLowerCase();
    return (!term || hay.includes(term)) && (status==="ALL" || x.status===status);
  });

  $("expenseTransactionsBody").innerHTML=rows.length?rows.map(row=>{
    const actions=[];
    if(row.status==="DRAFT"){
      actions.push(`<button class="table-action primary" data-expense-action="submit" data-id="${row.id}">Ajukan</button>`);
    }
    if(row.status==="SUBMITTED" && isCentralUser()){
      actions.push(`<button class="table-action approve" data-expense-action="approve" data-id="${row.id}">Setujui</button>`);
      actions.push(`<button class="table-action reject" data-expense-action="reject" data-id="${row.id}">Tolak</button>`);
    }

    const proofs=row.transaction_attachments||[];
    const proofCell=proofs.length
      ? `<button class="proof-btn" data-expense-action="proof" data-id="${row.id}">Lihat Bukti (${proofs.length})</button>`
      : `<span class="proof-missing">Belum ada</span>`;

    return `
      <tr>
        <td>${formatDate(row.transaction_date)}</td>
        <td><strong>${escapeHtml(row.transaction_number||"-")}</strong><span class="account-sub description-cell" title="${escapeHtml(row.description||"")}">${escapeHtml(row.description||"")}</span></td>
        <td>${escapeHtml(row.institutions?.name||"-")}</td>
        <td>${escapeHtml(row.expense_categories?.name||"-")}</td>
        <td>${escapeHtml(row.accounts?.account_name||"-")}</td>
        <td><strong>${rupiah(row.amount)}</strong></td>
        <td>${proofCell}</td>
        <td><span class="pill ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
        <td><div class="action-group">${actions.join("") || `<span class="account-sub">—</span>`}</div></td>
      </tr>`;
  }).join(""):`<tr><td colspan="9" class="empty">Belum ada data pengeluaran sesuai filter.</td></tr>`;
}

function resetExpenseForm(){
  $("expenseForm").reset();
  $("expenseDate").value=todayISO();
  $("expenseAmountPreview").textContent="Rp0";
  $("expenseProofName").textContent="Belum ada file dipilih";

  if(!isCentralUser() && currentProfile?.institution_id){
    $("expenseInstitution").value=currentProfile.institution_id;
    $("expenseInstitution").disabled=true;
    refreshExpenseAccountOptions();
  }else{
    $("expenseInstitution").disabled=false;
    $("expenseSourceAccount").innerHTML=`<option value="">Pilih kas/bank sumber</option>`;
    $("expenseSourceAccount").disabled=true;
  }
}

function safeFileName(name){
  return String(name||"bukti")
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g,"_")
    .replace(/_+/g,"_")
    .slice(-120);
}

async function uploadExpenseProof(transactionId,file){
  if(!file) return null;
  if(file.size>5*1024*1024) throw new Error("Ukuran bukti maksimal 5 MB.");

  const allowed=["image/jpeg","image/png","image/webp","application/pdf"];
  if(!allowed.includes(file.type)) throw new Error("Format bukti harus JPG, PNG, WEBP, atau PDF.");

  const path=`${transactionId}/${Date.now()}_${safeFileName(file.name)}`;
  const {error:uploadError}=await sb.storage
    .from("transaction-proofs")
    .upload(path,file,{cacheControl:"3600",upsert:false,contentType:file.type});

  if(uploadError) throw uploadError;

  const {error:metaError}=await sb.from("transaction_attachments").insert({
    transaction_id:transactionId,
    file_name:file.name,
    file_path:path,
    file_type:file.type,
    uploaded_by:currentSession.user.id
  });

  if(metaError){
    await sb.storage.from("transaction-proofs").remove([path]);
    throw metaError;
  }

  return path;
}

async function saveExpense(action){
  if(!currentSession?.user?.id) throw new Error("Sesi login tidak ditemukan.");

  const institution_id=$("expenseInstitution").value;
  const expense_category_id=$("expenseCategory").value;
  const source_account_id=$("expenseSourceAccount").value;
  const transaction_date=$("expenseDate").value;
  const amount=Number($("expenseAmount").value);
  const description=($("expenseDescription").value||"").trim();
  const file=$("expenseProof").files?.[0]||null;

  if(!transaction_date||!institution_id||!expense_category_id||!source_account_id||!amount||amount<=0){
    throw new Error("Lengkapi tanggal, lembaga, kategori, akun sumber, dan nominal.");
  }

  if(action==="submit" && !file){
    throw new Error("Bukti transaksi wajib diunggah sebelum pengeluaran diajukan.");
  }

  const selectedAccount=expenseAccounts.find(a=>a.id===source_account_id);
  if(!selectedAccount || selectedAccount.institution_id!==institution_id){
    throw new Error("Akun sumber tidak sesuai dengan lembaga yang dipilih.");
  }

  const payload={
    transaction_type:"EXPENSE",
    transaction_date,
    institution_id,
    fund_source_id:null,
    expense_category_id,
    source_account_id,
    destination_account_id:null,
    amount,
    description:description||null,
    status:"DRAFT",
    created_by:currentSession.user.id
  };

  const {data,error}=await sb.from("transactions").insert(payload).select("id,transaction_number").single();
  if(error) throw error;

  try{
    if(file) await uploadExpenseProof(data.id,file);

    if(action==="submit"){
      const {error:submitError}=await sb.rpc("submit_transaction",{p_transaction_id:data.id});
      if(submitError) throw submitError;
    }
  }catch(err){
    // Keep the draft transaction if proof/submission fails so there is an audit trail.
    throw new Error(`${err.message || "Gagal memproses bukti/submit"}. Transaksi tersimpan sebagai Draft.`);
  }

  resetExpenseForm();
  await Promise.all([loadExpenseTransactions(),loadDashboard()]);
  toast(action==="submit" ? `Pengeluaran ${data.transaction_number} berhasil diajukan.` : `Pengeluaran ${data.transaction_number} disimpan sebagai Draft.`);
}

async function submitExistingExpense(id){
  const row=expenseRowsCache.find(x=>x.id===id);
  const proofs=row?.transaction_attachments||[];
  if(!proofs.length){
    throw new Error("Transaksi belum memiliki bukti. Unggah bukti melalui form transaksi baru atau lengkapi bukti sebelum diajukan.");
  }
  const {error}=await sb.rpc("submit_transaction",{p_transaction_id:id});
  if(error) throw error;
  await Promise.all([loadExpenseTransactions(),loadDashboard()]);
  toast("Pengeluaran berhasil diajukan untuk approval.");
}

async function approveExpense(id){
  const row=expenseRowsCache.find(x=>x.id===id);
  if(!(row?.transaction_attachments||[]).length){
    throw new Error("Tidak dapat menyetujui pengeluaran tanpa bukti transaksi.");
  }
  if(!confirm("Setujui pengeluaran ini? Setelah APPROVED, saldo akun akan berkurang.")) return;
  const {error}=await sb.rpc("approve_transaction",{p_transaction_id:id,p_note:"Disetujui melalui SIMKEU"});
  if(error) throw error;
  await Promise.all([loadExpenseTransactions(),loadDashboard()]);
  toast("Pengeluaran disetujui. Saldo sudah diperbarui.");
}

async function rejectExpense(id){
  const note=prompt("Masukkan alasan penolakan:");
  if(note===null) return;
  if(!note.trim()){toast("Alasan penolakan wajib diisi.");return}
  const {error}=await sb.rpc("reject_transaction",{p_transaction_id:id,p_note:note.trim()});
  if(error) throw error;
  await Promise.all([loadExpenseTransactions(),loadDashboard()]);
  toast("Transaksi pengeluaran ditolak.");
}

async function viewExpenseProof(id){
  const row=expenseRowsCache.find(x=>x.id===id);
  const proofs=row?.transaction_attachments||[];
  if(!proofs.length) throw new Error("Bukti transaksi tidak ditemukan.");

  // Open first proof; if more than one, user can use repeated click after selecting in prompt
  let chosen=proofs[0];
  if(proofs.length>1){
    const list=proofs.map((p,i)=>`${i+1}. ${p.file_name}`).join("\n");
    const pick=prompt(`Pilih nomor bukti yang ingin dibuka:\n\n${list}`,"1");
    if(pick===null) return;
    const idx=Number(pick)-1;
    if(!Number.isInteger(idx)||idx<0||idx>=proofs.length) throw new Error("Pilihan bukti tidak valid.");
    chosen=proofs[idx];
  }

  const {data,error}=await sb.storage
    .from("transaction-proofs")
    .createSignedUrl(chosen.file_path,60);

  if(error) throw error;
  window.open(data.signedUrl,"_blank","noopener,noreferrer");
}

/* =========================================================
   AUTH + NAV
   ========================================================= */

$("loginForm").addEventListener("submit",async e=>{
  e.preventDefault(); $("loginError").classList.add("hidden");
  $("loginButton").disabled=true; $("loginButton").textContent="Memproses...";
  const {data,error}=await sb.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
  $("loginButton").disabled=false; $("loginButton").textContent="Masuk";
  if(error){$("loginError").textContent=error.message;$("loginError").classList.remove("hidden");return}
  if(data.session)await enterApp(data.session);
});

$("togglePassword").addEventListener("click",()=>{
  const p=$("password");p.type=p.type==="password"?"text":"password";
  $("togglePassword").textContent=p.type==="password"?"Lihat":"Sembunyi";
});

$("logoutBtn").addEventListener("click",async()=>{
  await sb.auth.signOut();
  currentProfile=null; currentSession=null;
  $("appView").classList.add("hidden");
  $("loginView").classList.remove("hidden");
  $("loginForm").reset();
});

$("refreshBtn").addEventListener("click",async()=>{
  const incomeVisible=!$("incomeSection").classList.contains("hidden");
  const expenseVisible=!$("expenseSection").classList.contains("hidden");
  if(incomeVisible) await Promise.all([loadDashboard(),loadIncomeTransactions()]);
  else if(expenseVisible) await Promise.all([loadDashboard(),loadExpenseTransactions()]);
  else await loadDashboard();
  toast("Data diperbarui.");
});

const meta={
  dashboard:["Dashboard","SIMKEU Yayasan Ar-Raudlah Kapedi"],
  pemasukan:["Pemasukan","Catatan seluruh dana masuk"],
  pengeluaran:["Pengeluaran","Catatan dan approval pengeluaran"],
  transfer:["Transfer Internal","Perpindahan dana antar lembaga"],
  bukti:["Bukti Transaksi","Dokumentasi nota, kuitansi, dan invoice"],
  lembaga:["Lembaga","Kelola unit di bawah Yayasan"],
  laporan:["Laporan","Rekap keuangan dan ekspor"],
  analitik:["Analitik","Diagram, tren, dan persentase"],
  pengguna:["Pengguna","Kelola akun dan hak akses"]
};

async function switchView(v){
  document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===v));
  $("pageTitle").textContent=meta[v][0];
  $("pageSubtitle").textContent=meta[v][1];

  $("dashboardSection").classList.toggle("hidden",v!=="dashboard");
  $("incomeSection").classList.toggle("hidden",v!=="pemasukan");
  $("expenseSection").classList.toggle("hidden",v!=="pengeluaran");
  $("placeholderSection").classList.toggle("hidden",v==="dashboard"||v==="pemasukan"||v==="pengeluaran");

  if(v==="pemasukan"){
    await loadIncomeModule();
  }else if(v==="pengeluaran"){
    await loadExpenseModule();
  }else if(v!=="dashboard"){
    $("placeholderTitle").textContent=meta[v][0];
  }

  closeSidebar();
}

document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
$("backDashboard").addEventListener("click",()=>switchView("dashboard"));

function openSidebar(){$("sidebar").classList.add("open");$("backdrop").classList.remove("hidden")}
function closeSidebar(){$("sidebar").classList.remove("open");$("backdrop").classList.add("hidden")}
$("menuBtn").addEventListener("click",openSidebar);
$("closeSidebar").addEventListener("click",closeSidebar);
$("backdrop").addEventListener("click",closeSidebar);

/* Income events */
$("incomeInstitution").addEventListener("change",refreshIncomeAccountOptions);
$("incomeAmount").addEventListener("input",()=>{
  $("incomeAmountPreview").textContent=rupiah(Number($("incomeAmount").value||0));
});
$("incomeSearch").addEventListener("input",renderIncomeRows);
$("incomeStatusFilter").addEventListener("change",renderIncomeRows);
$("refreshIncomeBtn").addEventListener("click",async()=>{
  await loadIncomeTransactions(); toast("Riwayat pemasukan diperbarui.");
});
$("newIncomeBtn").addEventListener("click",()=>{
  $("incomeFormCard").scrollIntoView({behavior:"smooth",block:"start"});
  setTimeout(()=>$("incomeDate").focus(),300);
});

$("saveIncomeDraftBtn").addEventListener("click",()=>{pendingIncomeSaveAction="draft"});
$("saveIncomeSubmitBtn").addEventListener("click",()=>{pendingIncomeSaveAction="submit"});

$("incomeForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const buttons=[$("saveIncomeDraftBtn"),$("saveIncomeSubmitBtn")];
  buttons.forEach(b=>b.disabled=true);
  try{
    await saveIncome(pendingIncomeSaveAction);
  }catch(err){
    console.error(err);
    toast("Gagal menyimpan pemasukan: "+(err.message||"error"));
  }finally{
    buttons.forEach(b=>b.disabled=false);
  }
});

$("incomeTransactionsBody").addEventListener("click",async e=>{
  const btn=e.target.closest("[data-income-action]");
  if(!btn)return;
  btn.disabled=true;
  try{
    const id=btn.dataset.id;
    const action=btn.dataset.incomeAction;
    if(action==="submit") await submitExistingIncome(id);
    if(action==="approve") await approveIncome(id);
    if(action==="reject") await rejectIncome(id);
  }catch(err){
    console.error(err);
    toast("Aksi gagal: "+(err.message||"error"));
  }finally{
    btn.disabled=false;
  }
});


/* Expense events */
$("expenseInstitution").addEventListener("change",refreshExpenseAccountOptions);
$("expenseAmount").addEventListener("input",()=>{
  $("expenseAmountPreview").textContent=rupiah(Number($("expenseAmount").value||0));
});
$("expenseProof").addEventListener("change",()=>{
  const f=$("expenseProof").files?.[0];
  $("expenseProofName").textContent=f ? `${f.name} • ${(f.size/1024/1024).toFixed(2)} MB` : "Belum ada file dipilih";
});
$("expenseSearch").addEventListener("input",renderExpenseRows);
$("expenseStatusFilter").addEventListener("change",renderExpenseRows);
$("refreshExpenseBtn").addEventListener("click",async()=>{
  await loadExpenseTransactions(); toast("Riwayat pengeluaran diperbarui.");
});
$("newExpenseBtn").addEventListener("click",()=>{
  $("expenseFormCard").scrollIntoView({behavior:"smooth",block:"start"});
  setTimeout(()=>$("expenseDate").focus(),300);
});

$("saveExpenseDraftBtn").addEventListener("click",()=>{pendingExpenseSaveAction="draft"});
$("saveExpenseSubmitBtn").addEventListener("click",()=>{pendingExpenseSaveAction="submit"});

$("expenseForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const buttons=[$("saveExpenseDraftBtn"),$("saveExpenseSubmitBtn")];
  buttons.forEach(b=>b.disabled=true);
  try{
    await saveExpense(pendingExpenseSaveAction);
  }catch(err){
    console.error(err);
    toast("Gagal menyimpan pengeluaran: "+(err.message||"error"));
  }finally{
    buttons.forEach(b=>b.disabled=false);
  }
});

$("expenseTransactionsBody").addEventListener("click",async e=>{
  const btn=e.target.closest("[data-expense-action]");
  if(!btn)return;
  btn.disabled=true;
  try{
    const id=btn.dataset.id;
    const action=btn.dataset.expenseAction;
    if(action==="submit") await submitExistingExpense(id);
    if(action==="approve") await approveExpense(id);
    if(action==="reject") await rejectExpense(id);
    if(action==="proof") await viewExpenseProof(id);
  }catch(err){
    console.error(err);
    toast("Aksi gagal: "+(err.message||"error"));
  }finally{
    btn.disabled=false;
  }
});

(async()=>{
  const {data:{session}}=await sb.auth.getSession();
  if(session)await enterApp(session);
})();
