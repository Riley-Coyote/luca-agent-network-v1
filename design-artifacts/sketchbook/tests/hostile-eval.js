export default { title: 'x', date: '2026-09-02', note: 'x', build: () => { try { return [eval('1+1')]; } catch (e) { return [{ k: 'p', ms: 1, err: String(e) }]; } } };
