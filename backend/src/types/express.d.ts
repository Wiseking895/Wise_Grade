import type { MembershipRecord } from '../auth/repository.js'
import type { AuthContext } from '../middleware/authenticate.js'
import type { SubjectAuthContext } from '../middleware/subject-authenticate.js'

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext
      schoolAccess?: MembershipRecord
      subjectAuth?: SubjectAuthContext
    }
  }
}

export {}
