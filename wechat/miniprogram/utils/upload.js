const { call } = require("./api");
const key = (id) => "uploads:" + id;
const read = (id) => wx.getStorageSync(key(id)) || [];
const write = (id, rows) => wx.setStorageSync(key(id), rows);
async function add(projectId, files) {
  const rows = read(projectId).filter((v) => v.state !== "done");
  for (const f of files)
    rows.push({
      localId: Date.now() + "-" + Math.random(),
      path: f.tempFilePath,
      size: f.size,
      state: "pending",
    });
  write(projectId, rows);
  return rows;
}
async function run(projectId, progress, stopped = () => false) {
  const rows = read(projectId);
  let index = 0;
  const publish = () => {
    write(projectId, rows);
    progress(rows);
  };
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (index < rows.length && !stopped()) {
        const row = rows[index++];
        if (row.state === "done") continue;
        row.state = "running";
        row.error = "";
        publish();
        try {
          if (!row.fileID) {
            await new Promise((resolve, reject) =>
              wx.getFileSystemManager().access({
                path: row.path,
                success: resolve,
                fail: () =>
                  reject(new Error("临时照片已失效，请从相册重新选择")),
              }),
            );
            row.ticket ||= await call("upload.prepare", {
              projectId,
              size: row.size,
              name: row.path.split("/").pop(),
            });
            publish();
            row.fileID = (
              await wx.cloud.uploadFile({
                cloudPath: row.ticket.cloudPath,
                filePath: row.path,
              })
            ).fileID;
            publish();
          }
          await call("upload.finish", {
            id: row.ticket.id,
            fileID: row.fileID,
          });
          row.state = "done";
        } catch (e) {
          row.state = "error";
          row.error = e.message || e.errMsg;
        }
        publish();
      }
    }),
  );
  return rows;
}
module.exports = { read, add, run };
