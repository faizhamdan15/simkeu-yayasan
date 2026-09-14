
const SUPABASE_URL = "https://mfuijgzytzfgigepaocz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_BSsA8_YGwXByhgc0_A4YyA_7QPMvELF";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const $ = id => document.getElementById(id);
let cashflowChart = null;
let expenseChart = null;

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
  clearTimeout(window.__toast); window.__toast=setTimeout(()=>t.classList.remove("show"),2500);
}
function roleLabel(r){
  return {SUPER_ADMIN:"Super Admin Yayasan",FOUNDATION_TREASURER:"Bendahara Yayasan",
    INSTITUTION_ADMIN:"Admin/Bendahara Lembaga",VIEWER:"Viewer"}[r]||r||"-";
}
function typeLabel(t){return {INCOME:"Pemasukan",EXPENSE:"Pengeluaran",TRANSFER:"Transfer"}[t]||t}
function typeClass(t){return {INCOME:"income",EXPENSE:"expense",TRANSFER:"transfer"}[t]||""}
function statusClass(s){return {APPROVED:"approved",SUBMITTED:"submitted",DRAFT:"draft",REJECTED:"rejected"}[s]||"draft"}
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

async function getProfile(uid){
  const {data,error}=await sb.from("profiles")
    .select("id,full_name,role,institution_id,institutions:institution_id(id,name,code,institution_type)")
    .eq("id",uid).single();
  if(error) throw error;
  return data;
}

async function enterApp(session){
  try{
    const p=await getProfile(session.user.id);
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    const first=(p.full_name||"Pengguna").trim().split(/\s+/)[0];
    $("userName").textContent=p.full_name||"Pengguna";
    $("userRole").textContent=roleLabel(p.role);
    $("avatar").textContent=first.charAt(0).toUpperCase();
    $("welcomeName").textContent=first;
    $("welcomeInstitution").textContent=
      ["SUPER_ADMIN","FOUNDATION_TREASURER"].includes(p.role)
      ? "Dashboard konsolidasi Yayasan dan seluruh lembaga"
      : "Lembaga: "+(p.institutions?.name||"-");
    $("today").textContent=new Intl.DateTimeFormat("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date());
    await loadDashboard();
  }catch(err){
    console.error(err);
    await sb.auth.signOut();
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
    toast("Dashboard diperbarui");
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
        {label:"Pemasukan",data:inc,borderColor:"#059669",backgroundColor:"rgba(5,150,105,.08)",fill:true,tension:.35,borderWidth:2,pointRadius:2},
        {label:"Pengeluaran",data:exp,borderColor:"#e58a2b",backgroundColor:"rgba(229,138,43,.03)",fill:false,tension:.35,borderWidth:2,pointRadius:2}
      ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"top",align:"end"},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${rupiah(c.raw)}`}}},
      scales:{x:{grid:{display:false}},y:{beginAtZero:true,ticks:{callback:v=>shortMoney(v)},grid:{color:"#eef2f0"}}}}
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
    data:{labels,datasets:[{data,backgroundColor:empty?["#e7ece9"]:["#059669","#10b981","#d6a84b","#3b82f6","#8b5cf6","#f59e0b","#ef4444","#14b8a6","#6366f1"],borderWidth:0}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:"67%",plugins:{legend:{position:"bottom",labels:{usePointStyle:true,boxWidth:8,font:{size:10}}},tooltip:{callbacks:{label:c=>empty?"Belum ada data":`${c.label}: ${rupiah(c.raw)}`}}}}
  });
}

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
$("logoutBtn").addEventListener("click",async()=>{await sb.auth.signOut();$("appView").classList.add("hidden");$("loginView").classList.remove("hidden");$("loginForm").reset()});
$("refreshBtn").addEventListener("click",loadDashboard);

const meta={
 dashboard:["Dashboard","Ringkasan keuangan Yayasan dan lembaga"],
 pemasukan:["Pemasukan","Catatan seluruh dana masuk"],
 pengeluaran:["Pengeluaran","Catatan dan approval pengeluaran"],
 transfer:["Transfer Internal","Perpindahan dana antar lembaga"],
 bukti:["Bukti Transaksi","Dokumentasi nota, kuitansi, dan invoice"],
 lembaga:["Lembaga","Kelola unit di bawah Yayasan"],
 laporan:["Laporan","Rekap keuangan dan ekspor"],
 analitik:["Analitik","Diagram, tren, dan persentase"],
 pengguna:["Pengguna","Kelola akun dan hak akses"]
};
function switchView(v){
  document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===v));
  $("pageTitle").textContent=meta[v][0];$("pageSubtitle").textContent=meta[v][1];
  $("dashboardSection").classList.toggle("hidden",v!=="dashboard");
  $("placeholderSection").classList.toggle("hidden",v==="dashboard");
  if(v!=="dashboard")$("placeholderTitle").textContent=meta[v][0];
  closeSidebar();
}
document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
$("backDashboard").addEventListener("click",()=>switchView("dashboard"));

function openSidebar(){$("sidebar").classList.add("open");$("backdrop").classList.remove("hidden")}
function closeSidebar(){$("sidebar").classList.remove("open");$("backdrop").classList.add("hidden")}
$("menuBtn").addEventListener("click",openSidebar);$("closeSidebar").addEventListener("click",closeSidebar);$("backdrop").addEventListener("click",closeSidebar);

(async()=>{
  const {data:{session}}=await sb.auth.getSession();
  if(session)await enterApp(session);
})();
