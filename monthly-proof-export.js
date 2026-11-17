/* SIMKEU - ekspor bukti pengeluaran bulanan, hanya APPROVED */
(function(){
  "use strict";
  const byId=id=>document.getElementById(id);
  const clean=v=>String(v??"-").normalize("NFKD").replace(/[^\x20-\x7e]/g," ").replace(/\s+/g," ").trim();
  function mount(){
    const section=byId("evidenceSection");
    if(!section||byId("monthlyProofExport"))return;
    const box=document.createElement("article");
    box.id="monthlyProofExport";
    box.className="panel evidence-filter-panel";
    box.style.cssText="padding:18px;margin:16px 0";
    box.innerHTML='<strong>Download Bukti Pengeluaran Bulanan</strong><p>Hanya pengeluaran APPROVED. PDF berisi rekap dan lampiran nota/kuitansi asli.</p><div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end"><label class="form-field"><span>Bulan</span><input id="monthlyProofMonth" type="month" value="2026-11"></label><button type="button" id="monthlyProofButton" class="brand-btn">Download PDF Bulanan</button></div>';
    const gallery=byId("evidenceGallery");
    section.insertBefore(box,gallery);
    byId("monthlyProofButton").addEventListener("click",download);
  }
  async function download(){
    const button=byId("monthlyProofButton");
    const month=byId("monthlyProofMonth").value;
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)){alert("Pilih bulan yang valid.");return;}
    if(!window.PDFLib||typeof sb==="undefined"){alert("Komponen PDF atau Supabase belum siap.");return;}
    button.disabled=true;
    const old=button.textContent;
    try{
      const [year,m]=month.split("-").map(Number);
      const next=m===12?String(year+1)+"-01-01":year+"-"+String(m+1).padStart(2,"0")+"-01";
      const institution=byId("evidenceInstitution")?.value;
      let rows=[],offset=0;
      while(true){
        let query=sb.from("transactions").select("id,transaction_number,transaction_date,institution_id,amount,description,institutions:institution_id(name),expense_categories:expense_category_id(name),transaction_attachments(id,file_name,file_path,file_type)")
          .eq("transaction_type","EXPENSE").eq("status","APPROVED")
          .gte("transaction_date",month+"-01").lt("transaction_date",next)
          .order("transaction_date",{ascending:true}).order("transaction_number",{ascending:true})
          .range(offset,offset+499);
        if(institution&&institution!=="ALL")query=query.eq("institution_id",institution);
        else if(!isCentralUser()&&currentProfile?.institution_id)query=query.eq("institution_id",currentProfile.institution_id);
        const result=await query;
        if(result.error)throw result.error;
        const batch=result.data||[];
        rows.push(...batch);
        if(batch.length<500)break;
        offset+=500;
        if(offset>=10000)throw new Error("Terlalu banyak transaksi. Pilih satu lembaga.");
      }
      if(!rows.length)throw new Error("Tidak ada pengeluaran APPROVED pada "+month);
      const {PDFDocument,StandardFonts,rgb}=window.PDFLib;
      const pdf=await PDFDocument.create();
      const font=await pdf.embedFont(StandardFonts.Helvetica);
      const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
      const W=595.28,H=841.89,M=40;
      let page=pdf.addPage([W,H]),y=H-M;
      function newPage(){page=pdf.addPage([W,H]);y=H-M;}
      function line(value,size=10,heavy=false){
        if(y<M+24)newPage();
        const text=clean(value);
        const f=heavy?bold:font;
        let remaining=text;
        const max=W-2*M;
        while(remaining.length){
          let n=remaining.length;
          while(n>1&&f.widthOfTextAtSize(remaining.slice(0,n),size)>max)n--;
          page.drawText(remaining.slice(0,n),{x:M,y,size,font:f,color:rgb(.15,.17,.2)});
          remaining=remaining.slice(n);
          y-=size+6;
          if(remaining&&y<M+24)newPage();
        }
        if(!text)y-=size+6;
      }
      line("YAYASAN AR-RAUDLAH KAPEDI",15,true);
      line("BUKTI PENGELUARAN BULANAN - APPROVED",12,true);
      line("Periode: "+month);
      line("Jumlah transaksi: "+rows.length);
      const money=n=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(n||0));
      line("TOTAL: "+money(rows.reduce((sum,r)=>sum+Number(r.amount||0),0)),11,true);
      y-=15;
      for(let i=0;i<rows.length;i++){
        const r=rows[i];
        if(y<M+100)newPage();
        line((i+1)+". "+r.transaction_date+" | "+r.transaction_number+" | "+money(r.amount),10,true);
        line("Lembaga: "+(r.institutions?.name||"-"));
        line("Kategori: "+(r.expense_categories?.name||"-"));
        line("Keterangan: "+(r.description||"-"));
        const proofs=r.transaction_attachments||[];
        line("Lampiran: "+proofs.length+" file");
        for(const proof of proofs){
          button.textContent="Memproses "+(i+1)+"/"+rows.length+"...";
          const result=await sb.storage.from("transaction-proofs").download(proof.file_path);
          if(result.error||!result.data)throw new Error("Gagal mengambil "+proof.file_name+": "+(result.error?.message||"tidak tersedia"));
          const bytes=await result.data.arrayBuffer();
          const type=(proof.file_type||result.data.type||"").toLowerCase();
          if(type==="application/pdf"||/\.pdf$/i.test(proof.file_name)){
            const src=await PDFDocument.load(bytes);
            const pages=await pdf.copyPages(src,src.getPageIndices());
            pages.forEach(p=>pdf.addPage(p));
            newPage();
          }else{
            let img;
            if(type==="image/png"||/\.png$/i.test(proof.file_name))img=await pdf.embedPng(bytes);
            else if(type==="image/jpeg"||/\.jpe?g$/i.test(proof.file_name))img=await pdf.embedJpg(bytes);
            else if(type==="image/webp"||/\.webp$/i.test(proof.file_name)){
              const bitmap=await createImageBitmap(result.data);
              const canvas=document.createElement("canvas");
              canvas.width=bitmap.width;canvas.height=bitmap.height;
              canvas.getContext("2d").drawImage(bitmap,0,0);
              bitmap.close();
              const png=await (await fetch(canvas.toDataURL("image/png"))).arrayBuffer();
              img=await pdf.embedPng(png);
            }else throw new Error("Format lampiran tidak didukung: "+proof.file_name);
            newPage();
            line("Lampiran: "+r.transaction_number+" - "+proof.file_name,9,true);
            const scale=Math.min((W-2*M)/img.width,(H-2*M-40)/img.height);
            page.drawImage(img,{x:M,y:H-M-30-img.height*scale,width:img.width*scale,height:img.height*scale});
            newPage();
          }
        }
        y-=12;
      }
      const bytes=await pdf.save();
      const url=URL.createObjectURL(new Blob([bytes],{type:"application/pdf"}));
      const a=document.createElement("a");
      a.href=url;a.download="SIMKEU_Bukti_Pengeluaran_APPROVED_"+month+".pdf";
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    }catch(error){console.error(error);alert("Download PDF gagal: "+(error.message||error));}
    finally{button.disabled=false;button.textContent=old;}
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);
  else mount();
})();