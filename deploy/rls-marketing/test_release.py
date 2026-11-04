import hashlib, importlib.util, json, os, pathlib, tempfile, unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('release',pathlib.Path(__file__).with_name('release.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ReleaseTest(unittest.TestCase):
 def test_compare_and_swap_preserves_other_release(self):
  current={'image':'sha256:nova','compose':'a,b','workdir':'/a','container':'id','started':'1','runtime_sha256':'h','compose_sha256':{'a':'1'}}
  with self.assertRaises(RuntimeError):m.conferir_base(current,{**current,'image':'sha256:velha'})
  with self.assertRaises(RuntimeError):m.conferir_base(current,{**current,'compose':'a,c'})
  m.conferir_base(current,current.copy())
 def test_runtime_restricted_without_owner(self):
  e=m.ambiente_restrito({'DATABASE_URL':'postgresql://mkt:dono@db:5432/os','JWT_SECRET':'preservar','DB_PASSWORD':'dono','DB_USER':'mkt'},'synthetic-app')
  self.assertEqual(e['TENANT_MODO'],'impor');self.assertEqual(e['JWT_SECRET'],'preservar')
  self.assertEqual(m.urlparse(e['DATABASE_URL']).username,'mktos_app')
  self.assertEqual(e['DATABASE_URL'],e['APP_DATABASE_URL'])
  self.assertNotIn('dono',str(e));self.assertEqual(e['DB_PASSWORD'],'')
 def test_rollback_cannot_restore_owner_or_observar(self):
  for e in [{'TENANT_MODO':'observar','DATABASE_URL':'postgresql://mktos_app:x@db/os'},
            {'TENANT_MODO':'impor','DATABASE_URL':'postgresql://mkt:x@db/os'}]:
   with self.assertRaises(RuntimeError):m.conferir_runtime(e)
  m.conferir_runtime(m.ambiente_restrito({'DATABASE_URL':'postgresql://mkt:x@db/os'},'qa'))
 def test_cas_compares_runtime_identity_and_compose_contents(self):
  base={'image':'sha256:x','compose':'a','workdir':'/a','container':'id','started':'1','runtime_sha256':'h','compose_sha256':{'a':'1'}}
  for key,value in [('workdir','/b'),('container','outro'),('started','2'),('runtime_sha256','outro'),('compose_sha256',{'a':'2'})]:
   with self.subTest(key=key),self.assertRaises(RuntimeError):m.conferir_base({**base,key:value},base)
 def test_runtime_rejects_different_destination_and_escaped_dollars(self):
  with self.assertRaises(RuntimeError):m.conferir_runtime({'TENANT_MODO':'impor','DATABASE_URL':'postgresql://mktos_app:x@db/os','APP_DATABASE_URL':'postgresql://mktos_app:x@outro/os'})
  self.assertEqual(m.escapar_compose({'PASSWORD':'a$b$$c'}),{'PASSWORD':'a$$b$$$$c'})
 def test_restore_marker_requires_passed_real_checks_and_correct_artifacts(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);(p/'pre-publish.dump').write_bytes(b'sintetico');sha=hashlib.sha256(b'sintetico').hexdigest()
   h={'status':'passed','release_id':p.name,'image_id':'sha256:x','exit_codes':{'boot':0,'tests':0},'checks':{'restricted_role':True,'authenticated_http':True,'rls_verified':True}}
   r={'status':'passed','release_id':p.name,'image_id':'sha256:x','backup_sha256':sha,'exit_codes':{'restore':0,'migrate':0,'checks':0},'checks':{'restore_completed':True,'migrations_applied':True,'integrity_verified':True}}
   m.validar_homolog(h,p.name,'sha256:x');m.validar_restore(r,p.name,'sha256:x',sha)
   for bad in [{**r,'status':'failed'},{**r,'backup_sha256':'outro'},{**r,'checks':{}},{**r,'exit_codes':{'restore':0}},{**r,'release_id':'outro'}]:
    with self.assertRaises(RuntimeError):m.validar_restore(bad,p.name,'sha256:x',sha)
   with self.assertRaises(RuntimeError):m.validar_homolog({'imagens_restritas_validadas':['sha256:x']},p.name,'sha256:x')
 def test_network_requires_real_shared_alias_and_expected_database(self):
  api={'NetworkSettings':{'Networks':{'outra':{},'compartilhada':{}}}}
  db={'Name':'/mktos_db','Config':{'Env':['POSTGRES_USER=mkt','POSTGRES_DB=marketing_os']},'NetworkSettings':{'Networks':{'compartilhada':{'Aliases':['db','mktos_db']}}}}
  self.assertEqual(m.rede_do_banco(api,db,'postgresql://mkt:qa@db/marketing_os'),'compartilhada')
  for url in ['postgresql://mkt:qa@outro/marketing_os','postgresql://mkt:qa@db/outro','postgresql://mktos_app:qa@db/marketing_os']:
   with self.assertRaises(RuntimeError):m.rede_do_banco(api,db,url)
 def test_detects_publishers_but_not_isolated_build(self):
  self.assertTrue(m.processo_de_publicacao('123 /bin/bash /srv/publicar-etapa10.sh'))
  self.assertTrue(m.processo_de_publicacao('123 docker compose -p root_marketing-os up -d api'))
  self.assertFalse(m.processo_de_publicacao('123 docker build -t rls-qa .'))
 def test_owner_preflight_refuses_different_effective_application_url(self):
  base={'DATABASE_URL':'postgresql://mkt:qa@db/marketing_os'}
  m.conferir_owner(base)
  with self.assertRaises(RuntimeError):m.conferir_owner({**base,'APP_DATABASE_URL':'postgresql://mktos_app:qa@outro/outro'})
  with self.assertRaises(RuntimeError):m.conferir_owner({**base,'DB_APP_USER':'mktos_app','DB_APP_PASSWORD':'qa'})
 def test_evidence_files_are_scoped_nonempty_and_hashed(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);f=p/'ensaio.log';f.write_text('ok');h=hashlib.sha256(b'ok').hexdigest()
   m.validar_evidencias({'evidence_files':{'ensaio.log':h}},p)
   for evidence in [{'../fora':h},{'ensaio.log':'errado'},{'ausente':h}]:
    with self.assertRaises(RuntimeError):m.validar_evidencias({'evidence_files':evidence},p)
   f.write_text('')
   with self.assertRaises(RuntimeError):m.validar_evidencias({'evidence_files':{'ensaio.log':h}},p)
 def test_release_directory_must_be_private_and_not_symlink(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);m.conferir_pasta_privada(p)
   os.chmod(p,0o755)
   with self.assertRaises(RuntimeError):m.conferir_pasta_privada(p)
 def test_owner_env_is_removed_even_when_migration_fails(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);dump=p/'pre-publish.dump';dump.write_bytes(b'backup sintetico');digest=m.sha(dump)
   env=['DATABASE_URL=postgresql://mkt:privado@db/marketing_os']
   meta={'image':'sha256:base','compose':'a','workdir':'/a','container':'id','started':'1','runtime_sha256':'h','compose_sha256':{'a':'1'},'inspect':{'Config':{'Env':env},'NetworkSettings':{'Networks':{'net':{}}}}}
   (p/'expected.json').write_text(json.dumps(m.snapshot(meta)))
   (p/'pre-publish-meta.json').write_text(json.dumps({**m.snapshot(meta),'cluster_id':'42','backup_sha256':digest}))
   (p/'homolog-approved.json').write_text(json.dumps({'status':'passed','release_id':p.name,'image_id':'sha256:new','exit_codes':{'boot':0,'tests':0},'checks':{'restricted_role':True,'authenticated_http':True,'rls_verified':True}}))
   (p/'restore-approved.json').write_text(json.dumps({'status':'passed','release_id':p.name,'image_id':'sha256:new','backup_sha256':digest,'exit_codes':{'restore':0,'migrate':0,'checks':0},'checks':{'restore_completed':True,'migrations_applied':True,'integrity_verified':True}}))
   with patch.object(m,'LOCK',str(p/'lock')),patch.object(m,'conferir_publicadores'),patch.object(m,'conferir_config'),patch.object(m,'atual',return_value=meta),patch.object(m,'out',return_value='sha256:new'),patch.object(m,'inspect',return_value={}),patch.object(m,'rede_do_banco',return_value='net'),patch.object(m,'comprovar_cluster',return_value='42'),patch.object(m,'run',side_effect=RuntimeError('migration falhou')):
    with self.assertRaisesRegex(RuntimeError,'migration falhou'):m.publicar(p,'new',p/'expected.json',apply=True)
   self.assertEqual(list(p.glob('migration-*.private.env')),[])
   with patch.object(m,'LOCK',str(p/'lock')),patch.object(m,'conferir_publicadores'),patch.object(m,'conferir_config',side_effect=RuntimeError('compose mudou')),patch.object(m,'atual',return_value=meta),patch.object(m,'out',return_value='sha256:new'),patch.object(m,'inspect',return_value={}),patch.object(m,'rede_do_banco',return_value='net'),patch.object(m,'comprovar_cluster',return_value='42'),patch.object(m,'run') as comandos:
    with self.assertRaisesRegex(RuntimeError,'compose mudou'):m.publicar(p,'new',p/'expected.json',apply=True)
    comandos.assert_not_called()
if __name__=='__main__':unittest.main()
