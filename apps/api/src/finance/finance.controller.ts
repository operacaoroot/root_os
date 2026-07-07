import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  CreateFinanceAccountSchema,
  CreateFinanceCategorySchema,
  CreateFinanceTransactionSchema,
  UpdateFinanceTransactionSchema,
  ImportOfxSchema,
  RegisterPluggyItemSchema,
  PluggyConnectTokenSchema,
} from '@mktos/shared';
import { FinanceService } from './finance.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('finance')
export class FinanceController {
  constructor(private readonly svc: FinanceService) {}

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
