// What every route handler gets: the config, the database and the hub.

import type { Config } from './config'
import type { DB } from './db'
import type { Hub } from './hub'

export type Ctx = { cfg: Config; db: DB; hub: Hub }
