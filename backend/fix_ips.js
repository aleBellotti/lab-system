const db = require('./database');
const r = db.prepare(
    "UPDATE dispositivos SET ip = '_eliminado_' || id || '_' || ip WHERE activo = 0 AND ip NOT LIKE '_eliminado_%'"
).run();
console.log('IPs liberadas:', r.changes);
