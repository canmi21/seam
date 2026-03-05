/* examples/github-dashboard/seam-app/src/client/main.tsx */

import './index.css'
import { seamHydrate } from '@canmi/seam-tanstack-router'
import { DATA_ID } from '../generated/client.js'
import routes from './routes.js'

const root = document.getElementById('__seam')
if (!root) throw new Error('Missing #__seam element')

seamHydrate({
  routes,
  root,
  dataId: DATA_ID,
})
