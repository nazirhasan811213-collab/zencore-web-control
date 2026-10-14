const {MemoryAuthStore}=require('../../auth-store');
const {hashPassword}=require('../../auth-core');
const init=MemoryAuthStore.prototype.init;
MemoryAuthStore.prototype.init=async function(){await init.call(this);if(!this.usersByEmail.has('test-admin@example.com'))await this.createUser({displayName:'Test Admin',email:'test-admin@example.com',passwordHash:await hashPassword('AdminFixture2026!'),role:'admin'});};
