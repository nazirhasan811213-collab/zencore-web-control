// Existing RBAC/profile tests use already-approved accounts. Public registration
// behaviour is tested separately with the real service and HTTP endpoints.
const {createAuthService:realService}=require('../../auth-service');
function createAuthService(options){const service=realService(options),register=service.register;service.register=async input=>{const result=await register(input);options.store.usersById.get(result.user.id).status='active';const login=await service.login({email:input.email,password:input.password});return {...result,...login,pendingApproval:false};};return service;}
module.exports={createAuthService};
