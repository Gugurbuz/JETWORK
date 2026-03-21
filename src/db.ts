import { supabase } from './supabase';

export const auth = supabase.auth;
export const db = supabase;

export const onAuthStateChanged = (authObj: any, callback: (user: any) => void) => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    const user = session?.user ? {
      uid: session.user.id,
      email: session.user.email,
      displayName: session.user.user_metadata?.full_name || session.user.email,
      photoURL: session.user.user_metadata?.avatar_url
    } : null;
    callback(user);
  });
  
  // Initial call
  supabase.auth.getSession().then(({ data: { session } }) => {
    const user = session?.user ? {
      uid: session.user.id,
      email: session.user.email,
      displayName: session.user.user_metadata?.full_name || session.user.email,
      photoURL: session.user.user_metadata?.avatar_url
    } : null;
    callback(user);
  });
  
  return () => subscription.unsubscribe();
};

export const signInWithGoogle = async () => {
  return supabase.auth.signInWithOAuth({ provider: 'google' });
};

export const logOut = () => supabase.auth.signOut();

export const signInWithEmailAndPassword = async (authObj: any, email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
};

export const createUserWithEmailAndPassword = async (authObj: any, email: string, password: string) => {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
};

export const signInAnonymously = async () => {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data;
};

export const signInWithUsernameOrEmail = async (authObj: any, input: string, password: string) => {
  let email = input;
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
  if (!isEmail) {
    const { data, error } = await supabase.from('users').select('email').eq('username', input).single();
    if (error || !data) throw new Error('Kullanıcı adı bulunamadı.');
    email = data.email;
  }
  return signInWithEmailAndPassword(authObj, email, password);
};

// Database mocks
export const collection = (db: any, ...args: string[]) => {
  if (args.length === 1) return { table: args[0], filters: [] };
  if (args.length === 3) return { table: args[2], filters: [{ field: 'workspace_id', op: '==', value: args[1] }] };
  return { table: args[0], filters: [] };
};

export const doc = (db: any, ...args: string[]) => {
  if (args.length === 2) return { table: args[0], id: args[1] };
  if (args.length === 4) return { table: args[2], id: args[3], workspace_id: args[1] };
  return { table: args[0], id: 'unknown' };
};

export const getDocFromServer = async (docRef: any) => {
  if (docRef.table === 'test') return { exists: () => true, data: () => ({}) };
  const idField = docRef.table === 'users' ? 'uid' : 'id';
  let req = supabase.from(docRef.table).select('*').eq(idField, docRef.id);
  if (docRef.workspace_id) {
    req = req.eq('workspace_id', docRef.workspace_id);
  }
  const { data: d, error: e } = await req.maybeSingle();
  
  if (e) throw e;
  
  return {
    exists: () => !!d,
    data: () => {
      if (!d) return undefined;
      const camelData: any = {};
      for (const key in d) {
        let camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
        if (key === 'photo_url') camelKey = 'photoURL';
        if (key === 'username') camelKey = 'displayName';
        camelData[camelKey] = d[key];
        if (key === 'created_at' || key === 'last_updated' || key === 'updated_at') {
          camelData[camelKey] = { toMillis: () => new Date(d[key]).getTime() };
        }
      }
      return camelData;
    }
  };
};

export const setDoc = async (docRef: any, data: any) => {
  const idField = docRef.table === 'users' ? 'uid' : 'id';
  const payload: any = { [idField]: docRef.id };
  if (docRef.workspace_id) payload.workspace_id = docRef.workspace_id;
  
  for (const key in data) {
    let snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    if (key === 'photoURL') snakeKey = 'photo_url';
    if (key === 'displayName') snakeKey = 'username';
    if (key === 'createdAt' || key === 'lastUpdated' || key === 'updatedAt') {
      payload[snakeKey] = data[key] === 'SERVER_TIMESTAMP' ? new Date().toISOString() : new Date(data[key]).toISOString();
    } else {
      payload[snakeKey] = data[key];
    }
  }
  
  const { error } = await supabase.from(docRef.table).upsert(payload);
  if (error) throw error;
};

export const updateDoc = async (docRef: any, data: any) => {
  const idField = docRef.table === 'users' ? 'uid' : 'id';
  const payload: any = {};
  
  for (const key in data) {
    let snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    if (key === 'photoURL') snakeKey = 'photo_url';
    if (key === 'displayName') snakeKey = 'username';
    if (data[key] && data[key].__isArrayUnion) {
      const { data: current } = await supabase.from(docRef.table).select(snakeKey).eq(idField, docRef.id).maybeSingle();
      const arr = (current as any)?.[snakeKey] || [];
      payload[snakeKey] = [...arr, data[key].value];
    } else if (data[key] && data[key].__isArrayRemove) {
      const { data: current } = await supabase.from(docRef.table).select(snakeKey).eq(idField, docRef.id).maybeSingle();
      const arr = (current as any)?.[snakeKey] || [];
      payload[snakeKey] = arr.filter((item: any) => JSON.stringify(item) !== JSON.stringify(data[key].value));
    } else if (key === 'createdAt' || key === 'lastUpdated' || key === 'updatedAt') {
      payload[snakeKey] = data[key] === 'SERVER_TIMESTAMP' ? new Date().toISOString() : new Date(data[key]).toISOString();
    } else {
      payload[snakeKey] = data[key];
    }
  }
  
  let req = supabase.from(docRef.table).update(payload).eq(idField, docRef.id);
  if (docRef.workspace_id) {
    req = req.eq('workspace_id', docRef.workspace_id);
  }
  const { error } = await req;
  if (error) throw error;
};

export const deleteDoc = async (docRef: any) => {
  const idField = docRef.table === 'users' ? 'uid' : 'id';
  let req = supabase.from(docRef.table).delete().eq(idField, docRef.id);
  if (docRef.workspace_id) {
    req = req.eq('workspace_id', docRef.workspace_id);
  }
  const { error } = await req;
  if (error) throw error;
};

export const serverTimestamp = () => 'SERVER_TIMESTAMP';

export const arrayUnion = (value: any) => ({ __isArrayUnion: true, value });
export const arrayRemove = (value: any) => ({ __isArrayRemove: true, value });

export const query = (col: any, ...args: any[]) => {
  const q = { ...col, filters: [...(col.filters || [])] };
  args.forEach(arg => {
    if (arg.type === 'orderBy') q.order = arg;
    if (arg.type === 'where') q.filters.push(arg);
  });
  return q;
};

export const orderBy = (field: string, direction = 'asc') => ({ type: 'orderBy', field, direction });
export const where = (field: string, op: string, value: any) => ({ type: 'where', field, op, value });

export const getDocs = async (queryObj: any) => {
  let req: any = supabase.from(queryObj.table).select('*');
  if (queryObj.filters) {
    queryObj.filters.forEach((f: any) => {
      const snakeField = f.field.replace(/[A-Z]/g, (letter: string) => `_${letter.toLowerCase()}`);
      if (f.op === '==') req = req.eq(snakeField, f.value);
      if (f.op === 'array-contains') req = req.contains(snakeField, [f.value]);
    });
  }
  if (queryObj.order) {
    const snakeField = queryObj.order.field.replace(/[A-Z]/g, (letter: string) => `_${letter.toLowerCase()}`);
    req = req.order(snakeField, { ascending: queryObj.order.direction === 'asc' });
  }
  
  const { data, error } = await req;
  if (error) throw error;
  
  return {
    empty: !data || data.length === 0,
    docs: (data || []).map((d: any) => {
      const camelData: any = {};
      for (const key in d) {
        let camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
        if (key === 'photo_url') camelKey = 'photoURL';
        if (key === 'username') camelKey = 'displayName';
        camelData[camelKey] = d[key];
        if (key === 'created_at' || key === 'last_updated' || key === 'updated_at') {
          camelData[camelKey] = { toMillis: () => new Date(d[key]).getTime() };
        }
      }
      return {
        id: d.uid || d.id,
        data: () => camelData
      };
    })
  };
};

export const onSnapshot = (queryObj: any, callback: (snapshot: any) => void, errorCallback?: (error: any) => void) => {
  let isUnsubscribed = false;
  let channel: any = null;
  let currentDocs: any[] = [];
  
  const isDoc = !!queryObj.id;
  const fetchFn = isDoc ? () => getDocFromServer(queryObj) : () => getDocs(queryObj);
  
  const mapSupabaseRowToDoc = (d: any) => {
    const camelData: any = {};
    for (const key in d) {
      let camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
      if (key === 'photo_url') camelKey = 'photoURL';
      if (key === 'username') camelKey = 'displayName';
      camelData[camelKey] = d[key];
      if (key === 'created_at' || key === 'last_updated' || key === 'updated_at') {
        camelData[camelKey] = { toMillis: () => new Date(d[key]).getTime() };
      }
    }
    return {
      id: d.uid || d.id,
      data: () => camelData
    };
  };

  fetchFn().then(snapshot => {
    if (isUnsubscribed) return;
    
    if (!isDoc) {
      currentDocs = snapshot.docs || [];
    }
    callback(snapshot);
    
    let filterStr = undefined;
    if (isDoc) {
      const idField = queryObj.table === 'users' ? 'uid' : 'id';
      filterStr = `${idField}=eq.${queryObj.id}`;
    } else if (queryObj.filters && queryObj.filters.length > 0) {
      const f = queryObj.filters[0];
      const snakeField = f.field.replace(/[A-Z]/g, (letter: string) => `_${letter.toLowerCase()}`);
      if (f.op === '==') filterStr = `${snakeField}=eq.${f.value}`;
      if (f.op === 'array-contains') filterStr = `${snakeField}=cs.{${f.value}}`;
    }
    
    channel = supabase.channel(`realtime:${queryObj.table}:${Math.random()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: queryObj.table, filter: filterStr }, (payload) => {
        if (isUnsubscribed) return;
        
        if (isDoc) {
          fetchFn().then(newSnapshot => {
            if (!isUnsubscribed) callback(newSnapshot);
          }).catch(e => {
            if (errorCallback) errorCallback(e);
          });
        } else {
          if (payload.eventType === 'INSERT') {
            const newDoc = mapSupabaseRowToDoc(payload.new);
            currentDocs = [...currentDocs, newDoc];
            
            if (queryObj.order) {
              const field = queryObj.order.field;
              const dir = queryObj.order.direction === 'asc' ? 1 : -1;
              currentDocs.sort((a, b) => {
                const valA = a.data()[field]?.toMillis ? a.data()[field].toMillis() : a.data()[field];
                const valB = b.data()[field]?.toMillis ? b.data()[field].toMillis() : b.data()[field];
                return valA > valB ? dir : valA < valB ? -dir : 0;
              });
            }
            callback({ empty: currentDocs.length === 0, docs: currentDocs });
          } else if (payload.eventType === 'UPDATE') {
            const updatedDoc = mapSupabaseRowToDoc(payload.new);
            currentDocs = currentDocs.map(d => d.id === updatedDoc.id ? updatedDoc : d);
            callback({ empty: currentDocs.length === 0, docs: currentDocs });
          } else if (payload.eventType === 'DELETE') {
            const deletedId = payload.old.id || payload.old.uid;
            currentDocs = currentDocs.filter(d => d.id !== deletedId);
            callback({ empty: currentDocs.length === 0, docs: currentDocs });
          }
        }
      })
      .subscribe();
      
    if (isUnsubscribed) {
      supabase.removeChannel(channel);
    }
  }).catch(e => {
    if (errorCallback) errorCallback(e);
  });
  
  return () => {
    isUnsubscribed = true;
    if (channel) {
      supabase.removeChannel(channel);
    }
  };
};

