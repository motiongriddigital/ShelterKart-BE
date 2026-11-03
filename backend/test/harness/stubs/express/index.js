function express(){ const routes=[]; const app={ routes, set(){},
  use(...a){ routes.push({method:'use', path: typeof a[0]==='string'?a[0]:'*', handlers:a.filter(f=>typeof f==='function')}); },
  get(p,...h){ routes.push({method:'get',path:p,handlers:h}); },
  all(p,...h){ routes.push({method:'all',path:p,handlers:h}); }, post(p,...h){ routes.push({method:'post',path:p,handlers:h}); },
  patch(p,...h){ routes.push({method:'patch',path:p,handlers:h}); }, delete(p,...h){ routes.push({method:'delete',path:p,handlers:h}); },
  listen(){ throw new Error('no listen'); } }; return app; }
express.json=()=> function jsonParser(req,res,next){ req._jsonParsed=true; next(); };
express.raw=()=> (req,res,next)=>next(); module.exports=express;
