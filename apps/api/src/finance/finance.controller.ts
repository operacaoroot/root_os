import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  CreateFinanceAccountSchema,
  CreateFinanceCategorySchema,
  CreateFinanceTransactionSchema,
  UpdateFinanceTransactionSchema,
  ImportOfxSchema,
  RegisterPluggyItemSchema,
  PluggyConnectTokenSchema,
  CreateChartAccountSchema,
  CreatePartnerSchema,
  CreateDimensionSchema,
  CreateContractSchema,
  ApproveSchema,
} from '@mktos/shared';
import { FinanceService } from './finance.service';
import { FinopsService } from './finops.service';
import { AprService } from './apr.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly svc: FinanceService,
    private readonly finops: FinopsService,
    private readonly apr: AprService,
  ) {}

  // --- FinOps: DRE + Plano de Contas ---
  @Get('dre')
  @RequirePermissions('financeiro.ver')
  dre(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('month') month?: string,
    @Query('departamentoId') departamentoId?: string,
  ) {
    return this.finops.dre(user.orgId, { from, to, month, departamentoId });
  }

  // --- AP/AR: parceiros, dimensões, contratos, contas a pagar/receber, aprovação ---
  @Get('partners')
  @RequirePermissions('financeiro.ver')
  listPartners(@CurrentUser() user: JwtUser, @Query('papel') papel?: string) {
    return this.apr.listPartners(user.orgId, papel);
  }

  @Post('partners')
  @RequirePermissions('financeiro.editar')
  createPartner(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.apr.createPartner(user.orgId, CreatePartnerSchema.parse(body), user.sub);
  }

  @Get('departamentos')
  @RequirePermissions('financeiro.ver')
  listDepartamentos(@CurrentUser() user: JwtUser) {
    return this.apr.listDimensions(user.orgId, 'departamento');
  }

  @Post('departamentos')
  @RequirePermissions('financeiro.editar')
  createDepartamento(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.apr.createDimension(user.orgId, 'departamento', CreateDimensionSchema.parse(body), user.sub);
  }

  @Get('projetos')
  @RequirePermissions('financeiro.ver')
  listProjetos(@CurrentUser() user: JwtUser) {
    return this.apr.listDimensions(user.orgId, 'projeto');
  }

  @Post('projetos')
  @RequirePermissions('financeiro.editar')
  createProjeto(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.apr.createDimension(user.orgId, 'projeto', CreateDimensionSchema.parse(body), user.sub);
  }

  @Get('contracts')
  @RequirePermissions('financeiro.ver')
  listContracts(@CurrentUser() user: JwtUser) {
    return this.apr.listContracts(user.orgId);
  }

  @Post('contracts')
  @RequirePermissions('financeiro.editar')
  createContract(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.apr.createContract(user.orgId, CreateContractSchema.parse(body), user.sub);
  }

  @Post('contracts/:id/gerar')
  @RequirePermissions('financeiro.editar')
  gerarContrato(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.apr.gerarContrato(user.orgId, id, user.sub);
  }

  @Get('payables')
  @RequirePermissions('financeiro.ver')
  payables(@CurrentUser() user: JwtUser, @Query('tipo') tipo?: string) {
    return this.apr.payables(user.orgId, tipo);
  }

  @Post('transactions/:id/approve')
  @RequirePermissions('financeiro.editar')
  approve(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const input = ApproveSchema.parse(body);
    return this.apr.approve(user.orgId, id, input.aprovar, user.sub);
  }

  @Get('chart-accounts')
  @RequirePermissions('financeiro.ver')
  listChartAccounts(@CurrentUser() user: JwtUser) {
    return this.finops.listChartAccounts(user.orgId);
  }

  @Post('chart-accounts')
  @RequirePermissions('financeiro.editar')
  createChartAccount(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = CreateChartAccountSchema.parse(body);
    return this.finops.createChartAccount(user.orgId, input, user.sub);
  }

  // --- Visão geral / fluxo de caixa ---
  @Get('summary')
  @RequirePermissions('financeiro.ver')
  summary(@CurrentUser() user: JwtUser) {
    return this.svc.summary(user.orgId);
  }

  @Get('cashflow')
  @RequirePermissions('financeiro.ver')
  cashflow(@CurrentUser() user: JwtUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.cashflow(user.orgId, { from, to });
  }

  // --- Contas ---
  @Get('accounts')
  @RequirePermissions('financeiro.ver')
  listAccounts(@CurrentUser() user: JwtUser) {
    return this.svc.listAccounts(user.orgId);
  }

  @Post('accounts')
  @RequirePermissions('financeiro.editar')
  createAccount(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = CreateFinanceAccountSchema.parse(body);
    return this.svc.createAccount(user.orgId, input, user.sub);
  }

  // --- Categorias ---
  @Get('categories')
  @RequirePermissions('financeiro.ver')
  listCategories(@CurrentUser() user: JwtUser) {
    return this.svc.listCategories(user.orgId);
  }

  @Post('categories')
  @RequirePermissions('financeiro.editar')
  createCategory(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = CreateFinanceCategorySchema.parse(body);
    return this.svc.createCategory(user.orgId, input, user.sub);
  }

  // --- Lançamentos ---
  @Get('transactions')
  @RequirePermissions('financeiro.ver')
  listTransactions(
    @CurrentUser() user: JwtUser,
    @Query('accountId') accountId?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('categoryId') categoryId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listTransactions(user.orgId, {
      accountId, status, type, categoryId, from, to, q,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('transactions')
  @RequirePermissions('financeiro.editar')
  createTransaction(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = CreateFinanceTransactionSchema.parse(body);
    return this.svc.createTransaction(user.orgId, input, user.sub);
  }

  @Patch('transactions/:id')
  @RequirePermissions('financeiro.editar')
  updateTransaction(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const input = UpdateFinanceTransactionSchema.parse(body);
    return this.svc.updateTransaction(user.orgId, id, input, user.sub);
  }

  @Delete('transactions/:id')
  @RequirePermissions('financeiro.editar')
  deleteTransaction(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.deleteTransaction(user.orgId, id, user.sub);
  }

  // --- Bancos (Open Finance / Pluggy) ---
  @Get('bank/connections')
  @RequirePermissions('financeiro.ver')
  listBankConnections(@CurrentUser() user: JwtUser) {
    return this.svc.listBankConnections(user.orgId);
  }

  @Post('bank/pluggy/connect-token')
  @RequirePermissions('financeiro.conciliar')
  pluggyConnectToken(@Body() body: unknown) {
    const input = PluggyConnectTokenSchema.parse(body ?? {});
    return this.svc.pluggyConnectToken(input.itemId);
  }

  @Post('bank/pluggy/item')
  @RequirePermissions('financeiro.conciliar')
  registerPluggyItem(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = RegisterPluggyItemSchema.parse(body);
    return this.svc.registerPluggyItem(user.orgId, input.itemId, user.sub);
  }

  @Post('bank/connections/:id/sync')
  @RequirePermissions('financeiro.conciliar')
  syncBank(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.syncBankConnection(user.orgId, id, user.sub);
  }

  // --- Importação de extrato OFX ---
  @Post('import/ofx')
  @RequirePermissions('financeiro.conciliar')
  importOfx(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = ImportOfxSchema.parse(body);
    return this.svc.importOfx(user.orgId, input.accountId, input.content, user.sub);
  }
}
