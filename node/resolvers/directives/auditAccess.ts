import type { GraphQLField } from 'graphql'
import { defaultFieldResolver } from 'graphql'
import { SchemaDirectiveVisitor } from 'graphql-tools'

import type StorefrontPermissions from '../../clients/storefrontPermissions'
import sendAuthMetric, { AuthMetric } from '../../metrics/auth'

export class AuditAccess extends SchemaDirectiveVisitor {
  public visitFieldDefinition(field: GraphQLField<any, any>) {
    const { resolve = defaultFieldResolver } = field

    field.resolve = async (
      root: any,
      args: any,
      context: Context,
      info: any
    ) => {
      this.sendAuthMetric(field, context)

      return resolve(root, args, context, info)
    }
  }

  private async sendAuthMetric(field: GraphQLField<any, any>, context: any) {
    const {
      clients: { storefrontPermissions },
      vtex: { adminUserAuthToken, storeUserAuthToken, account, logger },
      request,
    } = context

    const operation = field.astNode?.name?.value ?? request.url
    const forwardedHost = request.headers['x-forwarded-host'] as string
    const caller =
      context?.graphql?.query?.senderApp ??
      context?.graphql?.query?.extensions?.persistedQuery?.sender ??
      request.header['x-b2b-senderapp'] ??
      (request.headers['x-vtex-caller'] as string)

    const hasAdminToken = !!(
      adminUserAuthToken ?? (context?.headers.vtexidclientautcookie as string)
    )

    const hasStoreToken = !!storeUserAuthToken
    const hasApiToken = !!request.headers['vtex-api-apptoken']

    let role
    let permissions

    if (hasAdminToken || hasStoreToken) {
      const userPermissions = await this.getUserPermission(
        storefrontPermissions
      )

      role = userPermissions?.role?.slug
      permissions = userPermissions?.permissions
    }

    const authMetric = new AuthMetric(account, {
      caller,
      forwardedHost,
      hasAdminToken,
      hasApiToken,
      hasStoreToken,
      operation,
      permissions,
      role,
    })

    await sendAuthMetric(logger, authMetric)
  }

  private async getUserPermission(
    storefrontPermissions: StorefrontPermissions
  ) {
    const result = await storefrontPermissions.checkUserPermission()

    return result?.data?.checkUserPermission ?? null
  }
}
