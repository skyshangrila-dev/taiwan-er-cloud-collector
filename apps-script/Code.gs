const ER = Object.freeze({
  timeZone: "Asia/Taipei",
  sourcePage: "https://info.nhi.gov.tw/INAE4000/INAE4001S01",
  folderId: "1gkFYqVnO4RRBYKOXkVT1A_V-9gvZrQ0R",
  masterId: "1bhT-zpimz3NAr09fsj2KEzdeO8BedDJeTkpreUpXBTE",
  expectedIds: [
    "0101020017","0131060029","0132010014","0138010027","0401180014","0401180023",
    "0412040012","0421040011","0434010518","0439010518","0501110514","0601160016",
    "0602030026","0617060018","0933050018","0936050029","0936060016","0937010019",
    "0943030019","1101020018","1101100011","1101100020","1101150011","1101160017",
    "1111060015","1112010519","1112010537","1122010012","1131010011","1131050515",
    "1131100010","1131130018","1132070011","1134020019","1135050020","1136090519",
    "1137010024","1137010042","1137020511","1140010510","1140030012","1141310019",
    "1142100017","1142120001","1143010012","1145010010","1146010014","1231050017",
    "1301170017","1301200010","1302050014","1303260014","1317040011","1317050017",
    "1331040513","1331160010","1517061032","1535010051","1536030075"
  ]
});

const ER_CITIES = Object.freeze({
  "01":"臺北市","03":"臺中市","05":"臺南市","07":"高雄市","11":"基隆市",
  "12":"新竹市","22":"嘉義市","31":"新北市","32":"桃園市","33":"新竹縣",
  "34":"宜蘭縣","35":"苗栗縣","37":"彰化縣","38":"南投縣","39":"雲林縣",
  "40":"嘉義縣","43":"屏東縣","44":"澎湖縣","45":"花蓮縣","46":"臺東縣",
  "90":"金門縣","91":"連江縣"
});
const ER_LEVELS = Object.freeze({"1":"醫學中心","2":"區域醫院","3":"地區醫院"});

function setupDriveReceiver() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("INGEST_TOKEN")) {
    props.setProperty("INGEST_TOKEN", Utilities.getUuid() + Utilities.getUuid());
  }
  const master = SpreadsheetApp.openById(ER.masterId);
  ensureMasterSheets_(master);
  const result = {
    ok: true,
    token: props.getProperty("INGEST_TOKEN"),
    spreadsheetUrl: master.getUrl(),
    folderUrl: "https://drive.google.com/drive/folders/" + ER.folderId
  };
  console.log(JSON.stringify(result));
  return result;
}

function doPost(event) {
  try {
    const request = JSON.parse(event && event.postData ? event.postData.contents : "{}");
    const expectedToken = PropertiesService.getScriptProperties().getProperty("INGEST_TOKEN");
    if (!expectedToken || request.token !== expectedToken) throw new Error("Unauthorized collector");
    const payload = request.payload;
    validatePayload_(payload);
    return json_(savePayload_(payload));
  } catch (error) {
    return json_({ok:false,error:String(error && error.message ? error.message : error)});
  }
}

function doGet(event) {
  try {
    const action = event && event.parameter ? event.parameter.action : "status";
    if (action === "latest") return json_(latestPayload_());
    if (action === "trends") return json_(trendPayload_(event.parameter));
    if (action === "history") return json_(historyPayload_(event.parameter));
    const props = PropertiesService.getScriptProperties();
    return json_({
      ok:true,
      sourceUrl:ER.sourcePage,
      lastSuccessAt:props.getProperty("LAST_SUCCESS_AT") || null,
      sourceUpdatedAt:props.getProperty("LAST_SOURCE_UPDATED_AT") || null,
      hospitalCount:Number(props.getProperty("LAST_HOSPITAL_COUNT") || 0),
      spreadsheetUrl:"https://docs.google.com/spreadsheets/d/" + ER.masterId + "/edit",
      folderUrl:"https://drive.google.com/drive/folders/" + ER.folderId
    });
  } catch (error) {
    return json_({ok:false,error:String(error && error.message ? error.message : error)});
  }
}

function validatePayload_(payload) {
  if (!payload || typeof payload.sysdate !== "string" || !Array.isArray(payload.data)) {
    throw new Error("Invalid NHI payload");
  }
  if (payload.data.length !== ER.expectedIds.length) {
    throw new Error("Expected 59 hospitals; received " + payload.data.length);
  }
  const expected = {};
  ER.expectedIds.forEach(function(id) { expected[id] = true; });
  const seen = {};
  payload.data.forEach(function(row) {
    const id = String(row.hosP_ID || "");
    if (!expected[id]) throw new Error("Unexpected hospital id " + id);
    if (seen[id]) throw new Error("Duplicate hospital id " + id);
    if (!String(row.hosP_NAME || "").trim()) throw new Error("Missing hospital name " + id);
    if (!ER_CITIES[String(row.areA_NO_N || "")]) throw new Error("Invalid city for " + id);
    if (!ER_LEVELS[String(row.conT_TYPE || "")]) throw new Error("Invalid level for " + id);
    if (["Y","N"].indexOf(row.inform) < 0) throw new Error("Invalid 119 status for " + id);
    ["waiT_SEE_CNT","waiT_BED_CNT","waiT_GENERAL_CNT","waiT_ICU_CNT"].forEach(function(key) {
      const value = row[key];
      if (value !== null && value !== "" && (!isFinite(Number(value)) || Number(value) < 0)) {
        throw new Error("Invalid " + key + " for " + id);
      }
    });
    seen[id] = true;
  });
  const missing = ER.expectedIds.filter(function(id) { return !seen[id]; });
  if (missing.length) throw new Error("Missing hospital ids: " + missing.join(","));
}

function savePayload_(payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error("Collector is busy");
  try {
    const now = new Date();
    const slot = Math.floor(now.getTime() / 300000) * 300000;
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty("LAST_SUCCESS_SLOT") === String(slot)) {
      return {ok:true,skipped:true,reason:"slot-already-saved",slot:slot};
    }
    const master = SpreadsheetApp.openById(ER.masterId);
    ensureMasterSheets_(master);
    const collectedAt = format_(now, "yyyy-MM-dd HH:mm:ss");
    const dateKey = format_(now, "yyyy-MM-dd");
    const daily = ensureDaily_(dateKey, master);
    const totals = {visit:0,bed:0,ward:0,icu:0,full:0};
    const rows = payload.data.map(function(hospital) {
      const city = ER_CITIES[String(hospital.areA_NO_N)];
      const visit = nullableNumber_(hospital.waiT_SEE_CNT);
      const bed = nullableNumber_(hospital.waiT_BED_CNT);
      const ward = nullableNumber_(hospital.waiT_GENERAL_CNT);
      const icu = nullableNumber_(hospital.waiT_ICU_CNT);
      totals.visit += visit || 0; totals.bed += bed || 0; totals.ward += ward || 0; totals.icu += icu || 0;
      totals.full += hospital.inform === "Y" ? 1 : 0;
      return [collectedAt,payload.sysdate,String(hospital.hosP_ID),String(hospital.hosP_NAME),city,
        region_(city),ER_LEVELS[String(hospital.conT_TYPE)],cell_(visit),cell_(bed),cell_(ward),cell_(icu),
        hospital.inform === "Y" ? "是" : "否"];
    });
    const detail = daily.getSheetByName("醫院明細");
    detail.getRange(detail.getLastRow()+1,1,rows.length,rows[0].length).setValues(rows);
    master.getSheetByName("每5分鐘總覽").appendRow([
      collectedAt,payload.sysdate,rows.length,totals.visit,totals.bed,totals.ward,totals.icu,totals.full
    ]);
    master.getSheetByName("執行記錄").appendRow([collectedAt,"成功",payload.sysdate,rows.length,""]);
    props.setProperties({
      LAST_SUCCESS_SLOT:String(slot),LAST_SUCCESS_AT:now.toISOString(),LAST_SOURCE_UPDATED_AT:payload.sysdate,
      LAST_HOSPITAL_COUNT:String(rows.length),LATEST_DAILY_ID:daily.getId(),LATEST_DATE_KEY:dateKey
    }, false);
    finalizePreviousDay_(dateKey);
    return {ok:true,collectedAt:collectedAt,sourceUpdatedAt:payload.sysdate,hospitals:rows.length,
      dailySpreadsheetUrl:daily.getUrl()};
  } finally {
    lock.releaseLock();
  }
}

function ensureMasterSheets_(book) {
  ensureSheet_(book,"每5分鐘總覽",["收集時間（臺灣）","官方資料時間","醫院數","等待看診","等待推床","等待住院","等待加護病床","119滿床醫院數"]);
  ensureSheet_(book,"每日明細索引",["日期","檔案名稱","檔案連結","明細筆數","Excel檔案"]);
  ensureSheet_(book,"執行記錄",["執行時間（臺灣）","結果","官方資料時間","醫院數","訊息"]);
}

function ensureSheet_(book, name, headers) {
  let sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1,1,1,headers.length).setValues([headers]).setBackground("#124d49").setFontColor("#ffffff").setFontWeight("bold");
    sheet.setFrozenRows(1); sheet.setHiddenGridlines(true);
  }
  return sheet;
}

function ensureDaily_(dateKey, master) {
  const props = PropertiesService.getScriptProperties();
  const key = "DAILY_" + dateKey.replace(/-/g,"_");
  let book = null;
  const id = props.getProperty(key);
  if (id) { try { book = SpreadsheetApp.openById(id); } catch (error) {} }
  if (!book) {
    book = SpreadsheetApp.create("急診明細_" + dateKey);
    book.setSpreadsheetTimeZone(ER.timeZone);
    DriveApp.getFileById(book.getId()).moveTo(DriveApp.getFolderById(ER.folderId));
    const sheet = book.getSheets()[0];
    sheet.setName("醫院明細");
    sheet.getRange(1,1,1,12).setValues([["收集時間（臺灣）","官方資料時間","醫院代碼","醫院名稱","縣市","區域","層級","等待看診","等待推床","等待住院","等待加護病床","119滿床"]])
      .setBackground("#124d49").setFontColor("#ffffff").setFontWeight("bold");
    sheet.setFrozenRows(1); sheet.setHiddenGridlines(true);
    props.setProperty(key,book.getId());
    const index = master.getSheetByName("每日明細索引");
    const row = index.getLastRow()+1;
    index.getRange(row,1,1,5).setValues([[dateKey,"急診明細_"+dateKey,book.getUrl(),0,""]]);
  }
  return book;
}

function finalizePreviousDay_(todayKey) {
  const yesterday = new Date(new Date(todayKey + "T00:00:00+08:00").getTime() - 86400000);
  const dateKey = format_(yesterday,"yyyy-MM-dd");
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("XLSX_" + dateKey.replace(/-/g,"_"))) return;
  const sheetId = props.getProperty("DAILY_" + dateKey.replace(/-/g,"_"));
  if (!sheetId) return;
  const url = "https://docs.google.com/spreadsheets/d/" + sheetId + "/export?format=xlsx";
  const response = UrlFetchApp.fetch(url,{headers:{Authorization:"Bearer "+ScriptApp.getOAuthToken()}});
  if (response.getResponseCode() !== 200) throw new Error("Excel export failed: " + response.getResponseCode());
  const file = DriveApp.getFolderById(ER.folderId).createFile(response.getBlob().setName("急診明細_"+dateKey+".xlsx"));
  props.setProperty("XLSX_" + dateKey.replace(/-/g,"_"),file.getId());
  const master = SpreadsheetApp.openById(ER.masterId);
  const index = master.getSheetByName("每日明細索引");
  const values = index.getRange(2,1,Math.max(index.getLastRow()-1,1),1).getDisplayValues();
  values.forEach(function(row,i){ if(row[0]===dateKey) index.getRange(i+2,5).setValue(file.getUrl()); });
}

function latestPayload_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("LATEST_DAILY_ID");
  if (!id) throw new Error("No Drive snapshot available");
  const sheet = SpreadsheetApp.openById(id).getSheetByName("醫院明細");
  const count = Number(props.getProperty("LAST_HOSPITAL_COUNT") || 59);
  const rows = sheet.getRange(sheet.getLastRow()-count+1,1,count,12).getDisplayValues();
  const cityCodes = {}; Object.keys(ER_CITIES).forEach(function(code){cityCodes[ER_CITIES[code]]=code;});
  const levelCodes = {"醫學中心":"1","區域醫院":"2","地區醫院":"3"};
  return {ok:true,sysdate:rows[0][1],collectedAt:rows[0][0],cloudDrive:true,sourceUrl:ER.sourcePage,data:rows.map(function(row){
    return {hosP_ID:row[2],hosP_NAME:row[3],areA_NO_N:cityCodes[row[4]]||"",conT_TYPE:levelCodes[row[6]]||"",
      inform:row[11]==="是"?"Y":"N",waiT_SEE_CNT:value_(row[7]),waiT_BED_CNT:value_(row[8]),
      waiT_GENERAL_CNT:value_(row[9]),waiT_ICU_CNT:value_(row[10]),txT_DATE:row[1]};
  })};
}

function trendPayload_(params) {
  const sheet = SpreadsheetApp.openById(ER.masterId).getSheetByName("每5分鐘總覽");
  if (sheet.getLastRow()<2) return {ok:true,points:[]};
  const rows = sheet.getRange(2,1,sheet.getLastRow()-1,8).getDisplayValues();
  const from = Number(params.from || 0), to = Number(params.to || Date.now());
  return {ok:true,points:rows.map(function(row){return {collectedAt:parseTaipei_(row[0]),sourceUpdatedAt:row[1],hospitalCount:Number(row[2]),
    waitingVisit:Number(row[3]),waitingBed:Number(row[4]),waitingWard:Number(row[5]),waitingIcu:Number(row[6]),informed:Number(row[7])};})
    .filter(function(row){return row.collectedAt>=from && row.collectedAt<=to;})};
}

function historyPayload_(params) {
  const hospitalId = String(params.hospitalId || "");
  if (ER.expectedIds.indexOf(hospitalId)<0) throw new Error("Invalid hospital id");
  const from = Number(params.from || Date.now()-86400000), to = Number(params.to || Date.now());
  if (!(from<to) || to-from>7*86400000) throw new Error("History range must be within seven days");
  const props = PropertiesService.getScriptProperties();
  const points = [];
  for (let time=from; time<=to; time+=86400000) {
    const key = format_(new Date(time),"yyyy-MM-dd");
    const id = props.getProperty("DAILY_"+key.replace(/-/g,"_"));
    if (!id) continue;
    const sheet = SpreadsheetApp.openById(id).getSheetByName("醫院明細");
    if (sheet.getLastRow()<2) continue;
    const rows = sheet.getRange(2,1,sheet.getLastRow()-1,12).getDisplayValues();
    rows.forEach(function(row){
      const stamp=parseTaipei_(row[0]);
      if(row[2]===hospitalId && stamp>=from && stamp<=to) points.push({collectedAt:stamp,sourceUpdatedAt:row[1],
        waitingVisit:value_(row[7]),waitingBed:value_(row[8]),waitingWard:value_(row[9]),waitingIcu:value_(row[10]),informed:row[11]==="是"});
    });
  }
  points.sort(function(a,b){return a.collectedAt-b.collectedAt;});
  return {ok:true,hospitalId:hospitalId,points:points};
}

function format_(date, pattern){return Utilities.formatDate(date,ER.timeZone,pattern);}
function parseTaipei_(text){return new Date(String(text).replace(" ","T")+"+08:00").getTime();}
function nullableNumber_(value){if(value===null||value===undefined||value==="")return null;const n=Number(value);return isFinite(n)?n:null;}
function cell_(value){return value===null?"":value;}
function value_(value){return value===""?null:Number(value);}
function region_(city){
  if(["苗栗縣","臺中市","彰化縣","南投縣","雲林縣"].indexOf(city)>=0)return "中區";
  if(["嘉義市","嘉義縣","臺南市","高雄市","屏東縣","澎湖縣"].indexOf(city)>=0)return "南區";
  if(["花蓮縣","臺東縣"].indexOf(city)>=0)return "東區";
  return "北區";
}
function json_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}

